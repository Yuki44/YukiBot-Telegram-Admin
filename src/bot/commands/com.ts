import { BotContext } from "../../types";
import { sendAndAutoDelete } from "../helpers/sendAndAutoDelete";

const COMMANDS_TEXT = `
📋 <b>Lista de comandos de administración</b>

<b>— Avisos —</b>
/av [usuario] [razón] — Dar un aviso a un usuario. Al tercer aviso se banea automáticamente.
/elav [usuario] [razón] — Dar un aviso y eliminar el mensaje al que respondes.
/qav [usuario] — Quitar el último aviso de un usuario.
/avs [usuario] — Ver los avisos actuales de un usuario.

<b>— Silencio —</b>
/sil [usuario] — Silenciar a un usuario por 1 semana.
/silav [usuario] [razón] — Silenciar y registrar un aviso con razón.
/elsil — (responde a un mensaje) Eliminar el mensaje y silenciar al autor por 1 semana.
/elsilav [razón] — (responde a un mensaje) Eliminar el mensaje, silenciar al autor y registrar un aviso.
/qsil [usuario] — Quitar el silencio a un usuario.

<b>— Bans —</b>
/pban [usuario] — Perdonar el ban de un usuario y permitirle volver a unirse.

<b>— Configuración (solo owner) —</b>
/setup — Inicializar la configuración del grupo.
/syncadmins — Sincronizar la lista de administradores con Telegram.
/addtopic — Añadir un tema al filtro de tópicos.
/edittopic — Editar un tema existente.
/removetopic — Eliminar un tema del filtro.
/togglefeature [función] — Activar o desactivar una función del bot.
`.trim();

export async function comHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    try { await ctx.deleteMessage(); } catch { /* ignore */ }
    await sendAndAutoDelete(ctx, COMMANDS_TEXT, 1000);
  } catch {
    // silent fail
  }
}
