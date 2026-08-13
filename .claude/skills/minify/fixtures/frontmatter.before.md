---
name: fixture-skill
version: 1.0
description: >-
  Synthetic fixture standing in for a real skill file. Use when checking that the
  minifier refuses to touch a frontmatter description, since the description is
  the retrieval key a skill is matched against and only name + description are
  resident before the skill triggers.
---

# Fixture skill

WHEN a fixture run needs a file that carries YAML frontmatter.
MUST leave `name` and `description` byte-identical.
NEVER compress the description, even when it is the longest prose in the file.
WHY the description is a retrieval key, not prose; compressing it changes what
the skill matches and the failure is silent — the skill simply stops triggering.
