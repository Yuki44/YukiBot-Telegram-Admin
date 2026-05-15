# Architecture — YukiBot

> Technical architecture documentation for the YukiBot Telegram moderation bot and its companion web dashboard.

## System Context (C4 — Level 1)

```mermaid
C4Context
  title System Context — YukiBot

  Person(admin, "Group Admin / Owner", "Telegram user with admin role; uses bot commands and the web dashboard")
  Person(user, "Group Member", "Regular Telegram user")

  System(yukibot, "YukiBot", "Bot + web dashboard — TypeScript / Grammy / Express / React")

  System_Ext(telegram, "Telegram Bot API", "Message gateway")
  System_Ext(mongodb, "MongoDB Atlas", "Persistent storage")
  System_Ext(browser, "Browser", "Admin web client")

  Rel(admin, telegram, "Sends commands")
  Rel(user, telegram, "Sends messages")
  Rel(admin, browser, "Opens dashboard")
  Rel(browser, yukibot, "HTTPS /api + /assets")
  Rel(telegram, yukibot, "Webhook / polling")
  Rel(yukibot, telegram, "API calls")
  Rel(yukibot, mongodb, "Read/write")
```

## Container Diagram (C4 — Level 2)

```mermaid
C4Container
  title Container Diagram — YukiBot

  Container(bot, "Bot + API Process", "Node.js + Grammy + Express", "Single process: long-polling + REST API + static SPA")
  Container(spa, "Web SPA", "React + React Router + Vite", "Served from web/dist by the same process")
  ContainerDb(db, "MongoDB Atlas", "M0 Cluster", "Chat, Admin, User, Topic, Message, Credential, ActivityLog, BannedWord, SpamPattern, UserDomainAllowance")
  System_Ext(telegram, "Telegram Bot API")

  Rel(bot, telegram, "HTTPS", "Grammy client")
  Rel(bot, db, "Mongoose ODM")
  Rel(spa, bot, "fetch /api/*", "JSON over HTTPS")
```

## Layered Architecture

```mermaid
graph TD
  subgraph "Entry Point"
    INDEX[src/index.ts]
  end

  subgraph "API Server"
    APIS[Express app<br/>src/api/server.ts]
    AUTH[Auth routes]
    APIR[Resource routes<br/>chats, topics, users, …]
    APIMW[authenticate · requireChatAdmin]
  end

  subgraph "Bot Middleware Pipeline"
    MW1[loadChat] --> MW2[trackUser]
    MW2 --> MW3[trackTopic]
    MW3 --> MW4[isAdmin]
    MW4 --> MW5[adminOnlyCommands]
  end

  subgraph "Command Layer"
    CMD[Commands<br/>av/sil/bn/kk/spam/…]
  end

  subgraph "Handler Layer"
    HDL[Event Handlers<br/>chatMember, mediaForward, spamCallback]
  end

  subgraph "Feature Layer"
    FEAT[Feature Handlers<br/>topicFiltering · promoSpamDetection · bannedWordsEnforcement]
  end

  subgraph "Helper Layer"
    H1[resolveTarget]
    H2[applyWarn]
    H3[executeSilence]
    H4[sendAndAutoDelete]
    H5[sendLog]
    H6[forwardToLog]
    H7[profilePhoto]
    H8[html · contextHelpers]
  end

  subgraph "Data Access Layer"
    R1[chatRepository]
    R2[adminRepository]
    R3[userRepository]
    R4[topicRepository]
    R5[messageRepository]
    R6[credentialRepository]
    R7[activityLogRepository]
    R8[bannedWordRepository]
    R9[spamPatternRepository]
    R10[userDomainAllowanceRepository]
  end

  subgraph "Database"
    DB[(MongoDB Atlas)]
  end

  INDEX --> MW1
  INDEX --> APIS
  APIS --> APIMW
  APIMW --> AUTH & APIR
  APIR --> R1 & R2 & R3 & R4 & R7 & R8 & R9 & R10
  MW5 --> CMD
  MW5 --> HDL
  MW5 --> FEAT
  CMD --> H1 & H2 & H3 & H4 & H5 & H6 & H7 & H8
  HDL --> H5
  HDL --> R2 & R3
  FEAT --> R4 & R8 & R9
  H1 --> R3 & R2
  H2 --> R3
  H3 --> H1 & H2 & H4 & H5
  R1 & R2 & R3 & R4 & R5 & R6 & R7 & R8 & R9 & R10 --> DB
```

## Bot Middleware Pipeline

The middleware pipeline is critical and **order-sensitive**. Each stage enriches the `BotContext`:

```mermaid
sequenceDiagram
  participant T as Telegram API
  participant LC as loadChat
  participant TU as trackUser
  participant TT as trackTopic
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
  TU->>TT: ctx passed
  TT->>TT: Record forum topic (if applicable)
  TT->>IA: ctx passed
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

## API Request Pipeline

```mermaid
sequenceDiagram
  participant B as Browser SPA
  participant E as Express
  participant A as authenticate
  participant CA as requireChatAdmin
  participant R as Route handler
  participant DB as MongoDB

  B->>E: GET /api/chats/:chatId/users (Bearer JWT)
  E->>A: verify JWT
  A->>A: decode { userId, … }
  A->>CA: ctx.user set
  CA->>DB: Admin.findOne({ userId, chatId }) or ADMIN_IDS check
  alt not admin and not super-admin
    CA-->>B: 403
  end
  CA->>R: pass through
  R->>DB: repository call
  R-->>B: JSON
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
  I --> L[sendLog to audit channel + activityLog]
  J --> L
  K --> M[markBanned in DB]
  M --> L
```

## Anti-spam Flow

```mermaid
flowchart TD
  M[New message] --> F{promoSpamDetection enabled?}
  F -->|No| OK[Pass through]
  F -->|Yes| LA[analyzeLinks]
  LA --> WL{Domain in linkWhitelist<br/>or sender in spamUserWhitelist?}
  WL -->|Yes| OK
  WL -->|No| PM[patternMatcher]
  PM --> HIT{Matches learned pattern<br/>or heuristic flag?}
  HIT -->|No| OK
  HIT -->|Yes| LOG[Post detection to log channel<br/>with ✅ confirm / ↩️ undo buttons]
  LOG --> ADM[Admin clicks ✅]
  ADM --> ACT[delete + silence + warn + persist SpamPattern]
```

## Database Entity Relationships

```mermaid
erDiagram
  CHAT ||--o{ ADMIN : "has admins"
  CHAT ||--o{ USER : "has users"
  CHAT ||--o{ TOPIC : "has topics"
  CHAT ||--o{ MESSAGE : "has messages"
  CHAT ||--o{ BANNEDWORD : "has banned words"
  CHAT ||--o{ SPAMPATTERN : "has learned patterns"
  CHAT ||--o{ USERDOMAINALLOWANCE : "has per-user domain allowances"
  CHAT ||--o{ ACTIVITYLOG : "has audit entries"

  CHAT {
    number chatId PK
    string name
    string type
    boolean isActive
    boolean whitelist
    object features
    array linkWhitelist
    array spamUserWhitelist
    array hiddenAdminIds
    number delegatedOwnerId
    number logsTo
    number forwardsTo
    object logFlags
  }

  ADMIN {
    number userId PK
    number chatId PK
    string username
    string name
    string chatName
    string role
  }

  USER {
    number userId PK
    number chatId PK
    string username
    string name
    number warnings
    array warningReasons
    boolean isMuted
    date muteUntil
    boolean isBanned
    boolean wasBanned
    string photoFileId
  }

  TOPIC {
    number chatId PK
    number topicId PK
    string name
    array allowedMsgTypes
    boolean adminOnly
    boolean isUserConfigured
  }

  MESSAGE {
    number userId
    number chatId
    string fingerprint
    string text
    date timestamp
  }

  BANNEDWORD {
    number chatId
    string word
    string severity
    object actions
    boolean kick
    boolean flag
    string warnReason
    boolean exactMatch
    string scope
    number topicId
  }

  SPAMPATTERN {
    number chatId
    string pattern
    string fingerprint
    number learnedBy
    date createdAt
  }

  USERDOMAINALLOWANCE {
    number chatId
    number userId
    array domains
  }

  ACTIVITYLOG {
    number chatId
    string type
    string source
    number actorId
    number targetId
    string targetRef
    string reason
    number warningsAfter
    date timestamp
  }

  CREDENTIAL {
    string username PK
    string passwordHash
    number userId
    string name
    date createdAt
  }
```

## Feature Flag Pattern

```mermaid
flowchart TD
  A[Message arrives] --> B[Middleware pipeline]
  B --> C{Feature flag enabled?<br/>chatConfig.features.X}
  C -->|false| D[Skip — pass to next]
  C -->|true| E[Run feature logic]
  E --> F{Action condition met?}
  F -->|No| D
  F -->|Yes| G[Enforce action<br/>delete / warn / silence / kick]
  G --> D
```

## Deployment Architecture

```mermaid
graph LR
  subgraph "GitHub"
    GH[Repository] --> CI[GitHub Actions CI]
    CI --> |install + install:web + build + test + lint + format:check| PASS{Pass?}
    PASS -->|Yes| DEPLOY
    PASS -->|No| FAIL[Block merge]
  end

  subgraph "Railway"
    DEPLOY[Auto-deploy] --> DOCKER[Docker Container]
    DOCKER --> NODE[Node process<br/>bot polling + Express API + SPA]
  end

  subgraph "MongoDB Atlas"
    NODE --> ATLAS[(M0 Cluster)]
  end

  subgraph "Telegram"
    NODE <--> TAPI[Bot API]
  end

  subgraph "Browser"
    BROWSER[Admin browser] --> NODE
  end
```
