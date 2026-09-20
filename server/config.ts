import { z } from "zod";

const configSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("demo") }),
  z.object({
    mode: z.literal("live"),
    apiKey: z.string().trim().min(1),
    model: z.string().trim().min(1),
  }),
]);
export type Config = z.output<typeof configSchema>;
export function readConfig(env: NodeJS.ProcessEnv): Config {
  const result = configSchema.safeParse({
    mode: env["TYPESAFE_MODE"] ?? "demo",
    apiKey: env["TYPESAFE_API_KEY"],
    model: env["TYPESAFE_DEFAULT_MODEL"] ?? "jev-latest",
  });
  if (!result.success)
    throw new Error(
      "TYPESAFE_MODE muss demo oder live sein. Live benötigt TYPESAFE_API_KEY und einen Modellnamen.",
    );
  return result.data;
}
