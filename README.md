# Laya Decision Studio

A local decision app for exactly these two Ollama checkpoints:

- `laya:421m-typed-decisions-bf16`
- `laya:421m-english-bf16`

## Start and exit

Keep Ollama running on `http://127.0.0.1:11434`, then run:

```powershell
python run.py
```

If Laya is stuck in the background, run `python run.py --stop` or double-click `Stop-Laya.cmd`, then start it again. This force-stops only this project's native app and verified launcher processes, discarding unsaved work. For a normal exit with the save popup, close the app window.

You can also double-click `Start-Laya.cmd` or run `npm.cmd start`. The launcher opens a dedicated, sandbox-enabled Electron window. **Closing the window first offers Save JSON, Save Excel, Save Both, Discard, or Cancel.** After saving or discarding, the conversation clears, the window closes, the Laya UI server stops, and the Python launcher exits. Ollama stays running for other applications. Launching again while the app is open brings that window forward.

Requirements: Windows, Node.js 22.3 or newer, and Python 3 for `run.py`. The CMD launcher works without Python. For a fresh copy, install dependencies once:

```powershell
npm.cmd ci
```

The app uses its own window profile under `.laya-browser/`; it does not control or close your normal browser windows. Conversations do not restore automatically after exit. If the preferred UI port is occupied, the app uses the next free port. `PORT` can set a preferred starting port. Ollama always uses its separate port 11434.

For an optional browser-only server, run `npm.cmd run start:web`. This mode stays running until Ctrl+C; closing a normal browser tab cannot stop it. Use `run.py` for the requested close-to-exit behavior.

## Tabs and files

- **Home:** choose a model and decision type, enter your question, supply context, then define answer options.
- **Templates:** all six editable examples, kept off Home.
- **Help:** decision types, model limits, and sources.

The top toolbar has three file controls:

- **Save JSON:** saves every decision in the current conversation and your current draft, including its model, context, question, option labels, descriptions, and returned probabilities.
- **Load JSON:** restores that conversation and draft so you can add further decisions. It also accepts the single-decision JSON files exported by earlier versions. Existing content is replaced only after confirmation. Invalid files leave the current conversation intact.
- **Export Excel:** creates a real `.xlsx` workbook with **Decisions**, **Probabilities**, and **Current setup** sheets. Numeric probabilities remain numeric and are formatted as percentages. Context and questions are preserved as literal text.

In the dedicated app window, toolbar exports open a Windows **Save As** dialog so you can choose the location. In browser-only mode, the browser handles downloads. JSON files support up to 500 decisions and a 20 MB input size. Use JSON to continue later; Excel is a readable report and cannot be loaded as a conversation.

The close popup saves the same conversation and unfinished draft as the toolbar. **Save Both** asks for two locations. Cancelling the popup or a Save As dialog keeps the app and conversation open. A failed file write also keeps the app open and reports the error. If you cancel the second file after the first has saved, that first file remains saved. **Discard** closes without exporting. Every completed exit clears the active conversation, including after saving; use **Load JSON** to resume it later.

## Decision modes

Below **Context**, **Add files** imports PDF, Word (`.docx`, `.doc`), Markdown (`.md`, `.markdown`), text, and Excel (`.xlsx`, `.xls`, `.xlsm`, `.csv`). Select up to five files, review or edit their extracted text, then append it to your existing context or replace it. File names, PDF page numbers, and workbook sheet names identify the extracted passages. No text enters Context until you click **Use this text**.

Files are parsed locally in temporary reader processes and are not saved by the importer. JSON and Excel exports retain the text you insert. Imports accept 10 MB per file, up to 200 pages per PDF, and 200,000 extracted characters per file. Long previews require you to select or shorten the relevant text to fit the 24,000-character Context field. The selected model's smaller token limit still applies. PDF scans need OCR first; images and charts are not extracted. Excel formulas use cached saved values and are not recalculated. Password-protected documents need an unprotected copy.

| Mode | Native primitive | Result |
| --- | --- | --- |
| Bool | `noul` | Probability of true and false, with editable descriptions |
| Choice | `choice` | Chosen label and the full option distribution |
| Ranking | `choice` | Alternatives sorted by relative probability |

Options work like a form editor: type your own labels, add optional descriptions, click **Add option**, press **Enter** for the next row, or paste one label per line. Rows can be removed. Choice and Ranking use 2–26 options. Keep labels distinct and option sets small.

**Ctrl+Enter / Cmd+Enter** runs the current question. Each model request evaluates the explicitly supplied context. Loading a conversation restores the visible results and input setup; previous results are not silently inserted into model context. Laya produces typed decisions rather than generated explanatory paragraphs.

Previously saved Score results remain loadable and exportable. Reusing their setup selects Choice with the same option labels and descriptions.

## Local storage and interpretation

The current window keeps the conversation, draft, and up to 40 recent decisions in temporary session storage so refreshing does not lose your work. Closing the desktop app clears that temporary data. A fresh launch starts empty; files are retained only when you explicitly save them. Older automatic local-storage conversation backups are removed when the updated UI starts.

The inference server does not write conversation content to disk or logs. Files you explicitly export contain your context. The UI loads local assets and makes inference requests only to your local Ollama daemon. External documentation opens only when you click its links.

Probabilities are estimates. The API's confidence is displayed as **concentration**, not as probability of correctness. Published default total context budgets are 1,024 tokens for Typed Decisions and 512 for English, shared by context, question, and options. Character counts are not token counts, and long input may be truncated by the runtime.

## Verification

```powershell
npm.cmd test
python -m unittest discover -s tests -p test_launcher.py -v
npm.cmd run test:ui
```

These cover server contracts, safe JSON validation, Excel cell contents, native-window save/discard/cancel behavior, failed saves, shutdown and port release, fresh launches, restored conversations followed by new real decisions, template tabs, responsive layouts, and all three decision modes on both installed models. Native-dialog responses and some failure scenarios are simulated in automated checks; real files and window shutdown are verified.

For a separate live-model report with a running browser-only server:

```powershell
npm.cmd run test:live
```

`verification/live-results.json` records real input/output pairs (six per current live-check run). Screenshots and window-lifecycle evidence are also in `verification/`. These checks do not establish model accuracy on arbitrary decisions. Native Save As dialog placement and interaction remain dependent on the Windows desktop environment.

PowerShell on this machine blocks `npm.ps1`; use `npm.cmd` as shown. No execution-policy change is needed.

## Sources and structure

The native model contract follows [Ollama's Laya guide](https://ollama.com/library/laya). Checkpoint limits come from the [upstream model card](https://huggingface.co/convaiinnovations/laya). See [RESEARCH.md](RESEARCH.md) for the source investigation.

`run.py` calls `Start-Laya.cmd`; `desktop.mjs` launches the native runtime. `desktop-main.cjs` owns the window, close/save dialogs, and server lifecycle; `desktop-preload.cjs` exposes a narrow file-save bridge to the sandboxed UI. `server.mjs` provides local-only inference, file extraction, and export routes. `context-files.mjs` manages bounded parser processes; `context-worker.mjs` reads documents. `public/` contains the UI and versioned JSON validator. `workbook.mjs` creates Excel exports. `tests/` contains the reproducible checks. Generated verification reports, browser profiles, and dependencies are excluded from Git.
