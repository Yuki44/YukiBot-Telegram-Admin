import { BotContext } from "../../types";
import { executeSilence } from "../helpers/executeSilence";

export async function elsilavHandler(ctx: BotContext): Promise<void> {
  await executeSilence(ctx, { deleteTargetMsg: true, applyWarning: true });
}
