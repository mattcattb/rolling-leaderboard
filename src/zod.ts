import { z } from "zod";
import type { TimeframeSpec } from "./declarative";
import type {
  LeaderboardBoardDefinition,
  LeaderboardSchemaDefinition,
} from "./schema";
import { boardKeys, timeframeKeys } from "./schema";

export function lbQuerySchema<
  const TTimeframes extends Record<string, TimeframeSpec>,
  const TBoards extends Record<
    string,
    LeaderboardBoardDefinition<keyof TTimeframes & string>
  >,
>(definition: LeaderboardSchemaDefinition<TTimeframes, TBoards>) {
  type Board = keyof TBoards & string;
  type Timeframe = keyof TTimeframes & string;

  const board = z.enum(boardKeys(definition));
  const timeframe = z.enum(timeframeKeys(definition));
  const direction = z.enum(["asc", "desc"]);

  const supports = (selectedBoard: Board, selectedTimeframe: Timeframe) =>
    definition.leaderboards[selectedBoard].timeframes.includes(selectedTimeframe);

  const base = z
    .object({
      leaderboard: board.default(definition.defaults.leaderboard as Board),
      timeframe: timeframe.default(definition.defaults.timeframe as Timeframe),
      direction: direction.default(definition.defaults.sort ?? "desc"),
      includeScores: z.array(board).optional(),
    })
    .superRefine((value, ctx) => {
      if (!supports(value.leaderboard as Board, value.timeframe as Timeframe)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["timeframe"],
          message: `Leaderboard "${value.leaderboard}" does not support timeframe "${value.timeframe}"`,
        });
      }
    });

  const list = base.extend({
    limit: z
      .number()
      .int()
      .min(1)
      .max(definition.defaults.maxLimit ?? 100)
      .default(definition.defaults.limit ?? 25),
  });

  const user = base.extend({
    userId: z.string().min(1),
  });

  return {
    board,
    timeframe,
    direction,
    base,
    list,
    user,
  };
}

/** @deprecated Use `lbQuerySchema(...)`. */
export const createLbQuerySchema = lbQuerySchema;
