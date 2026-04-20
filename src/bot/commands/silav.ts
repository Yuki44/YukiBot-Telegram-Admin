import { BotContext } from "../../types";
import { executeSilence } from "../helpers/executeSilence";

export async function silavHandler(ctx: BotContext): Promise<void> {
  await executeSilence(ctx, { deleteTargetMsg: false, applyWarning: true });
}
