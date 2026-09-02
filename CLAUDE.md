# Variation Fee Calculator & RA Toolbox – CLAUDE.md

## Projects

### Variation Fee Calculator
Web tool calculating pharma variation fees (EU/EMA/CH/IS/NO/UK/RS).
- **Features**: Fee calculation, Excel formula interpreter, WordPress plugin version
- **Shortcode**: `[variation_fee_calculator]` (single instance per page)

### RA Toolbox
Variation management suite with multiple tools.
- **Tools**: Guided Workflow, Budget Planning, Annual Update, Classification Lookup, Worksharing, etc.
- **Status & Architecture**: See memory at `D:\ClaudeConfig\projects\D--Claude\memory/`
  - `guided-workflow.md` – Guided Workflow (8 tools, shared fee/workload engine)
  - `worksharing.md` – Worksharing logic & UI
  - `variation-toolbox-user-guide.md` – User guide (Progressive Disclosure modal)

## Canonical Paths

- **Source**: `D:\Claude\Variation Fee Calculator\variation-fee-calculator\`
- **Deliverable**: ZIP file for WordPress upload

## Key Conventions

- **WordPress Deployment**: ZIP archives (folder must be top-level in ZIP)
- **Shortcodes**: Single-instance globals (not multi-instantiable)
- **State & Architecture**: Documented in user memory files (consult before complex tasks)

## Working with Claude

### Before Complex Tasks

Read current source files from `D:\Claude\Variation Fee Calculator\variation-fee-calculator\` — do not rely on memory alone.

### Model Selection Strategy

- **Haiku**: UI/UX, layout, simple features
- **Sonnet**: Business logic, integration, worksharing details
- **Opus**: Complex domain logic (Supergrouping, fee edge cases, debugging)

See memory at `D:\ClaudeConfig\projects\D--Claude\memory\model-selection.md` for decomposition strategy.

## Important Notes

⚠️ **Windows-specific tooling:**
- `.docx` export: Render via Word COM (no LibreOffice/pandoc)
- Excel: Never use `openpyxl` (loses drawings); use COM instead
- Screenshots: In-app browser tool often fails → use real Chrome

⚠️ **Before implementation:** Always read current project state from disk, never rely on memory.

---

## 🛠️ Skills & Plugins für dieses Projekt

**Verfügbare Skills für Toolbox-Entwicklung:** (Siehe [[skill-discovery-protocol]])

| Aufgabe | Skill | Verwendung |
|---------|-------|------------|
| **Feature-Architektur** | feature-dev:code-architect | Neue Tools designen |
| **Code-Qualität** | feature-dev:code-reviewer | Bugs & Quality-Checks |
| **Codebase verstehen** | feature-dev:code-explorer | Architektur-Analyse |
| **Excel-Formel parsen** | defuddle | Formula-Interpretation |
| **UI-Tests** | playwright-cli | E2E-Testing, Browser-Automation |
| **Workflows planen** | superpowers:brainstorming | Feature-Design, UX-Planning |
| **Debugging** | superpowers:systematic-debugging | Fehler-Root-Cause-Analyse |
| **Python-Analysen** | notebookim | Fee-Kalkulationen, Statistiken |
| **Dokumentation** | context7-cli | Projekt-Kontext sammeln |
| **Deployment-Automation** | cli | ZIP-Packaging, WordPress-Upload |

**Automatische Erkennung:**
- "Neue Worksharing-Feature" → feature-dev:code-architect + superpowers:brainstorming
- "Bug in Fee-Berechnung" → feature-dev:code-reviewer + superpowers:systematic-debugging
- "Excel-Formeln interpretieren" → defuddle
- "WordPress-ZIP erstellen" → cli
