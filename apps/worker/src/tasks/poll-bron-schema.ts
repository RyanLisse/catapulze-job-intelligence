import { z } from "zod";

export const pollBronPayload = z.object({
  bronId: z.string().uuid(),
  bronSlug: z.enum(["inhuurdesk", "tenderned"]),
  scrapeRunId: z.string().uuid(),
});

export type PollBronPayload = z.infer<typeof pollBronPayload>;
