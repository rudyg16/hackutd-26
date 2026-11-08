# implement

Implement the next uncompleted task for the person given as `$ARGS` (a, b, or c).

## Steps

1. **Git hygiene** — run `git pull origin main` to get the latest changes.

2. **Load the task list** — read `docs/tasks-$ARGS.md`. Find the first line matching `- [ ]`. That is your task. If none exist, report "All tasks done for person $ARGS." and stop.

3. **Load the contract** — read `shared/types.ts` and `shared/api.ts`. These are the cross-team source of truth.

4. **Read only what you need** — read the existing files directly relevant to this task (see `CLAUDE.md` for your ownership scope). Do **not** read files owned by other people unless you need to understand an interface you're calling.

5. **Implement the task** — write the code. Follow conventions visible in the files you read. Use Tailwind classes from `CLAUDE.md`'s token list; don't add inline styles. Keep it minimal — no features the task doesn't ask for.

6. **Type-check** — run `npx tsc --noEmit`. Fix any errors before proceeding. If errors are in files you don't own, note them and move on.

7. **Commit** — stage only files you own, then commit:
   ```
   git add <your-files-only>
   git commit -m "<short present-tense description of what this task does>"
   git push -u origin HEAD
   ```

8. **Mark done** — in `docs/tasks-$ARGS.md`, change that task's `- [ ]` to `- [x]`.

9. **Report** — one line: `Done: <task name>. Next: <next unchecked task title or "all done">`.

## Rules
- Touch only files in your ownership scope (see `CLAUDE.md`).
- One task per run. Stop after step 9 and wait for the user to run `/implement $ARGS` again.
- If a dependency from another person isn't built yet, read `seed/base.json` or `seed/demo.json` for static data, then note in your report what you're waiting for.
