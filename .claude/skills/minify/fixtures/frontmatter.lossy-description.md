---
name: fixture-skill
version: 1.0
description: Fixture skill for frontmatter checks.
---

# Fixture skill

WHEN a fixture run needs a file that carries YAML frontmatter.
MUST leave `name` and `description` byte-identical.
NEVER compress the description, even when it is the longest prose in the file.
WHY the description is a retrieval key, not prose; compressing it changes what
the skill matches and the failure is silent — the skill simply stops triggering.
