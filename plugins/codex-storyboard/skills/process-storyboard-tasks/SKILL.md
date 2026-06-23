---
name: process-storyboard-tasks
description: Process pending Codex Storyboard image and video generation tasks. Use when the user asks to generate storyboard assets, process the storyboard queue, generate all shots, generate a specific storyboard row, or return Image Generation, HyperFrames, or Remotion outputs to the local storyboard.
---

# Process Codex Storyboard Tasks

Process the local storyboard queue at `http://127.0.0.1:43218`.

## Workflow

1. Call `list_storyboard_generation_tasks` with status `pending`.
2. Process tasks one at a time.
3. Before generating, call `claim_storyboard_generation_task`.
4. Route by `generator`:

   - `image-gen`: use the built-in `imagegen` skill and built-in image generation tool. Treat `visualPrompt` as the primary prompt and honor the task's `aspectRatio`. Copy the final verified image into the active workspace before completing the task.
   - `hyperframes`: use the HyperFrames and HyperFrames CLI skills. Create a self-contained composition using the task's `width`, `height`, duration, and `visualPrompt`, then lint, inspect, render to MP4, and verify the output.
   - `remotion`: use the Remotion skill. Create or reuse a Remotion composition using the task's `width` and `height`, render an MP4 matching the task duration, and verify the output.

5. Call `complete_storyboard_generation_task` with the exact absolute output path and correct media type.
6. If generation or verification fails, call `fail_storyboard_generation_task` with the concise cause.
7. Continue until no pending tasks remain.

## Output locations

Use a separate project and task folder in the active workspace:

```text
generation/<project-id>/<task-id>/
```

Keep source code for video tasks in that folder. The MCP completion tool copies the final image or video into the storyboard media directory.

## Guardrails

- Do not mark a task complete until the exact local file has been visually or technically verified.
- Do not silently switch a requested HyperFrames task to Remotion, or vice versa.
- Do not use external API keys for Image Generation when the built-in image tool is available.
- Do not process `manual` generator rows.
- Preserve the requested duration for video tasks.
- Preserve `projectId`, `aspectRatio`, `width`, and `height`; never return an asset to a different project.
