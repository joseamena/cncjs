# Guitar job library

`guitar-library.json` maps a guitar, part, configuration, and ordered operation to an existing G-code file. cncjs reads this directory at request time and calculates a SHA-256 checksum for every operation.

The included Doug operation is a non-executable preview. Do not set `"executable": true` until the referenced file, tool, setup instructions, zeroing procedure, and preview have been validated on the intended machine.

To use a library elsewhere, configure it in `.cncrc`:

```json
{
  "guitarLibrary": {
    "directory": "/home/pi/guitar-jobs",
    "manifest": "guitar-library.json"
  }
}
```

Each operation requires `id`, `name`, `tool`, `gcode`, and `checklist`. Optional display fields include `description` and `workZero`. Execution is locked unless `executable` is exactly `true`.
