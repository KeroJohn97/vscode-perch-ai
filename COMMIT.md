# Git Commit Skills & Conventions

This project enforces the [Conventional Commits Specification](https://conventionalcommits.org). Following these guidelines ensures readable git history, safer code rollbacks, and automated versioning.

## 🛠️ The Anatomy of a Commit

All commit messages must match the following layout:

```text
<type>(<optional scope>): <short imperative description>

<optional body: detailed explanation of what and why>

<optional footer: breaking changes or issue tracking numbers>
```

---

## 🧭 Core Rules

### 1. Structural Formatting

- **Header Length:** Keep the first line under 50 characters.
- **Imperative Mood:** Write your summary line as a command (e.g., `add` not `added`, `fix` not `fixes`).
- **Punctuation:** Do not end the header line with a period.
- **Separation:** Leave a blank line between the header, the body, and the footer.
- **Body Width:** Wrap lines in the body text at 72 characters.

### 2. Commit Atomic Change

- Focus each commit on **one single logical change**.
- Do not bundle unrelated bug fixes and features together.

---

## 🏷️ Allowed Commit Types

| Type       | Purpose                                               | Example                                         |
| :--------- | :---------------------------------------------------- | :---------------------------------------------- |
| `feat`     | Introduces a brand new feature to the codebase        | `feat(auth): add google oauth login`            |
| `fix`      | Patches a bug or fixes broken behavior                | `fix(ui): repair overlapping navigation bar`    |
| `refactor` | Changes code without fixing a bug or adding a feature | `refactor: simplify database connection pool`   |
| `docs`     | Modifies documentation files                          | `docs: update setup steps in README`            |
| `style`    | Changes code formatting, whitespace, or semicolons    | `style: run prettier formatting on core utils`  |
| `test`     | Adds missing tests or corrects existing test suites   | `test(api): add integration tests for checkout` |
| `chore`    | Updates build scripts, dependencies, or CI configs    | `chore: upgrade typescript to latest version`   |
| `perf`     | Implements changes that improve performance           | `perf: optimize images using webp compression`  |

---

## 💥 Breaking Changes

When introducing a breaking change that requires user or architectural migration, you must:

1. Append an exclamation mark (`!`) right after the type or scope.
2. Include a `BREAKING CHANGE:` label in the footer explaining the migration.

### Example:

```text
feat(api)!: drop support for v1 endpoints

The v1 endpoints are deprecated and no longer supported.

BREAKING CHANGE: The `/v1/users` endpoint has been removed. Use `/v2/users` instead.
```

---

## 🔗 Tracking Issues

Always link your issues or project cards in the footer using the syntax required by your platform (GitHub/GitLab/Jira).

```text
fix(cart): resolve null pointer exception when emptying cart

Closes #102
```

---

## 🚀 Automation & Tooling

To ensure compliance, our repository utilizes the following tools:

- **Husky:** Manages local git hooks.
- **Commitlint:** Validates your commit message structure on `commit-msg`.

If your commit violates these rules, the git CLI will reject the commit and provide an error message pointing to the issue.
