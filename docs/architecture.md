# Architecture — YukiBot

> Technical architecture documentation for YukiBot Telegram moderation bot.

## System Context (C4 — Level 1)

```mermaid
C4Context
  title System Context — YukiBot

  Person(admin, "Group Admin", "Telegram user with admin role")
  Person(user, "Group Member", "Regular Telegram user")

  System(yukibot, "YukiBot", "Telegram moderation bot — TypeScript/Grammy")

  System_Ext(telegram, "Telegram Bot API", "Message gateway")
  System_Ext(mongodb, "MongoDB Atlas", "Persistent storage")

  Rel(admin, telegram, "Sends commands")
  Rel(user, telegram, "Sends messages")
  Rel(telegram, yukibot, "Webhook / polling")
  Rel(yukibot, telegram, "API calls")
  Rel(yukibot, mongodb, "Read/write")
```

## Container Diagram (C4 — Level 2)

```mermaid
C4Container
  title Container Diagram — YukiBot

  Container(bot, "Bot Process", "Node.js + Grammy", "Long-polling process handling Telegram updates")
  ContainerDb(db, "MongoDB Atlas", "M0 Cluster", "Chat, Admin, User, Topic, Message collections")
  System_Ext(telegram, "Telegram Bot API")

  Rel(bot, telegram, "HTTPS", "Grammy client")
  Rel(bot, db, "Mongoose ODM")
```

## Layered Architecture

```mermaid
graph TD
  subgraph "Entry Point"
    INDEX[index.ts]
  end

  subgraph "Middleware Pipeline"
    MW1[loadChat] --> MW2[trackUser]
    MW2 --> MW3[isAdmin]
    MW3 --> MW4[adminOnlyCommands]
  end

  subgraph "Command Layer"
    CMD[Commands<br/>av, sil, bn, kk, ...]
  end

  subgraph "Handler Layer"
    HDL[Event Handlers<br/>chatMember, media, spam]
  end

  subgraph "Feature Layer"
    FEAT[Feature Handlers<br/>topicFiltering]
  end

  subgraph "Helper Layer"
    H1[resolveTarget]
    H2[applyWarn]
    H3[executeSilence]
    H4[sendAndAutoDelete]
    H5[sendLog]
    H6[html / contextHelpers]
  end

  subgraph "Data Access Layer"
    R1[chatRepository]
    R2[adminRepository]
    R3[userRepository]
    R4[topicRepository]
  end

  subgraph "Database"
    DB[(MongoDB Atlas)]
  end

  INDEX --> MW1
  MW4 --> CMD
  MW4 --> HDL
  MW4 --> FEAT
  CMD --> H1 & H2 & H3 & H4 & H5 & H6
  HDL --> H5
  HDL --> R2 & R3
  FEAT --> R4
  H1 --> R3 & R2
  H2 --> R3
  H3 --> H1 & H2 & H4 & H5
  R1 & R2 & R3 & R4 --> DB
```

## Middleware Pipeline

The middleware pipeline is critical and **order-sensitive**. Each stage enriches the `BotContext`:

```mermaid
sequenceDiagram
  participant T as Telegram API
  participant LC as loadChat
  participant TU as trackUser
  participant IA as isAdmin
  participant AO as adminOnlyCommands
  participant CMD as Command Handler

  T->>LC: Update arrives
  LC->>LC: Load Chat doc from DB
  LC->>LC: Check whitelist
  alt whitelist: false
    LC-->>T: Ignore (chatConfig = null)
  end
  LC->>TU: ctx.chatConfig set
  TU->>TU: Upsert User doc
  TU->>IA: ctx passed
  IA->>IA: Check Admin collection + API fallback
  IA->>AO: ctx.isAdmin set
  AO->>AO: Is this a YukiBot command?
  alt Non-admin using protected command
    AO->>T: Delete message
  else Admin or non-command
    AO->>CMD: Pass through
  end
  CMD->>T: Execute action
```

## Warning System Flow

```mermaid
flowchart TD
  A[Admin: /av @user reason] --> B[resolveTarget]
  B --> C{Target found?}
  C -->|No| D[Reply: user not found]
  C -->|Yes| E{Is target admin?}
  E -->|Yes| F[Silently ignore]
  E -->|No| G[incrementWarning in DB]
  G --> H{warnings count}
  H -->|1/3| I[Send warning 1/3]
  H -->|2/3| J[Send warning 2/3 + last chance]
  H -->|3/3| K[Auto-ban + notify]
  I --> L[sendLog to audit channel]
  J --> L
  K --> M[markBanned in DB]
  M --> L
```

## Database Entity Relationships

```mermaid
erDiagram
  CHAT ||--o{ ADMIN : "has admins"
  CHAT ||--o{ USER : "has users"
  CHAT ||--o{ TOPIC : "has topics"
  CHAT ||--o{ MESSAGE : "has messages"

  CHAT {
    number chatId PK
    string name
    string type
    boolean isActive
    boolean whitelist
    object features
    number logsTo
    number forwardsTo
    object logFlags
  }

  ADMIN {
    number userId PK
    number chatId PK
    string username
    string name
    string role
  }

  USER {
    number userId PK
    number chatId PK
    string username
    number warnings
    boolean isBanned
    boolean wasBanned
  }

  TOPIC {
    number chatId PK
    number topicId PK
    string name
    array allowedMsgTypes
  }

  MESSAGE {
    number userId
    number chatId
    string fingerprint
    date timestamp
  }
```

## Feature Flag Pattern

```mermaid
flowchart TD
  A[Message arrives] --> B[Middleware pipeline]
  B --> C{Feature: topicFiltering?}
  C -->|false| D[Skip — pass to next]
  C -->|true| E[Check topic rules]
  E --> F{Message type allowed?}
  F -->|Yes| D
  F -->|No| G[Delete message]
  G --> D
```

## Deployment Architecture

```mermaid
graph LR
  subgraph "GitHub"
    GH[Repository] --> CI[GitHub Actions CI]
    CI --> |Build + Test + Lint| PASS{Pass?}
    PASS -->|Yes| DEPLOY
    PASS -->|No| FAIL[Block merge]
  end

  subgraph "Railway"
    DEPLOY[Auto-deploy] --> DOCKER[Docker Container]
    DOCKER --> BOT[YukiBot Process]
  end

  subgraph "MongoDB Atlas"
    BOT --> ATLAS[(M0 Cluster)]
  end

  subgraph "Telegram"
    BOT <--> TAPI[Bot API]
  end
```

