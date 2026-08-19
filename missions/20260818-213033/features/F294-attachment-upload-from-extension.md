# F294: upload the annotated screenshot

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F292, F285

## Assertion IDs covered
- AS-559: the created task carries the annotated screenshot
- AS-566: an oversized image is rejected with a message naming the limit, before the task is created
- AS-567: a failed upload does not leave a task with a broken image reference

## Draft scope
- Upload with the user's own JWT to the existing attachments bucket, so existing RLS is the boundary and no service key is involved.
- Order of operations decided explicitly and stated in the handoff: either upload first and create the task with the reference, or create then upload and roll back on failure. Half-states are the failure mode to design against.
- Size check before upload using the same constant the web app uses.

## Files (approximate)
extension/src/submit/upload.ts, lib/validation/attachments.ts

## Notes for clarification
- F274 (M10 follow-up) is adding magic-byte sniffing for avatars; the same argument applies to this path — note it rather than expanding scope here.
- MCP at run: none.
