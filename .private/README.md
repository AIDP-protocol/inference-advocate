# Local notes

This directory is for material that should not land in the public tree: session handoffs,
open decision memos, paste prompts for an editor, scratch plans, host-specific paths, and
anything personal to the author (emails, machine layout, real credentials, local ops notes).

Everything under `.private/` except this file is gitignored. Put files here freely; they will
not appear in `git status` and will not be committed.

The same rule applies to run directories (`.advocate/`, `.advocate-public/`): keys, provider
configs with live endpoints, and env files stay there. They are ignored for the same reason.

Anything the advocate surfaces publicly (UI warnings, export view, demo site) must stay free
of personal identifiers and absolute host paths. Prefer basenames, relative run-dir names, or
a plain statement of the gap.
