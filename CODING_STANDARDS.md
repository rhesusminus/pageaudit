# pageaudit coding standards

## Output

- **OUT-1**: Anything that leaves the program (API responses, stored results, report files)
  uses the documented report shape (`schema/report.schema.json`), never internal runner objects.
  _Why: internal fields leak, and outputs stop matching the schema users rely on._

## Checks

- **CHK-1**: A check encodes a general rule, not a fix fitted to one site, platform or theme.
  Platform-specific causes go in the advice text, not in the check's trigger.
  _Why: pageaudit audits many sites; a rule fitted to one misses the others._

## Jobs

- **JOB-1**: Every audit that enters an in-progress state reaches a final state on every path,
  including when saving its result fails.
  _Why: a row left `running` makes the progress page wait forever._

## Messages

- **MSG-1**: User-facing text says what the code actually did. "Deleted" means the data is gone;
  if it is only hidden, say hidden.

## Performance

- **PRF-1**: Work over page-sized input (elements, links, labels) is linear. Build a map or
  index once; never rescan the document inside a loop over it.
  _Why: page HTML is attacker-sized; quadratic work turns one large page into a stall that
  blocks the server._
