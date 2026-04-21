import { BotContext } from "../../types";

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
/qsilav [usuario] — Quitar el silencio y el último aviso de un usuario.

<b>— Expulsiones y Bans —</b>
/kk [usuario] — Echar a un usuario del grupo (puede volver a unirse).
/bn [usuario] — Banear a un usuario permanentemente (no puede volver).
/qban [usuario] — Quitar el ban de un usuario y permitirle volver a unirse.

<b>— Anti-Spam —</b>
/spam — (responde a un mensaje) Eliminar + silenciar + avisar + aprender el patrón.
/nospam [id|userId] — Eliminar un patrón aprendido por ID de patrón o ID de usuario.
/wladd [dominio] — Añadir dominio a la lista blanca de enlaces.
/wldel [dominio] — Quitar dominio de la lista blanca de enlaces.
/wls — Ver dominios en la lista blanca de enlaces.
/wluadd [userId] — Añadir usuario a la lista blanca de spam (no se detecta su contenido).
/wludel [userId] — Quitar usuario de la lista blanca de spam.
/wlus — Ver usuarios en la lista blanca de spam.

<b>— Configuración (solo owner) —</b>
/setup — Inicializar la configuración del grupo.
/addtopic — Añadir un tema al filtro de tópicos.
/edittopic — Editar un tema existente.
/removetopic — Eliminar un tema del filtro.
/togglefeature [función] — Activar o desactivar una función del bot.
`.trim();

export async function comHandler(ctx: BotContext): Promise<void> {
  if (!ctx.chatConfig) return;

  try {
    const sent = await ctx.reply(COMMANDS_TEXT, {
      parse_mode: "HTML",
      message_thread_id: ctx.message?.message_thread_id,
    });
    try {
      await ctx.api.deleteMessage(ctx.chat!.id, sent.message_id);
    } catch {
      /* ignore */
    }
    try {
      await ctx.deleteMessage();
    } catch {
      /* ignore */
    }
  } catch {
    // silent fail (G10)
  }
}
