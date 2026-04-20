import { BotContext } from "../../types";
import { executeSilence } from "../helpers/executeSilence";

export async function silHandler(ctx: BotContext): Promise<void> {
  await executeSilence(ctx, { deleteTargetMsg: false, applyWarning: false });
}
