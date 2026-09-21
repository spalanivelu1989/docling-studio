"""The Evidence Agent: answers a question from both engines, as scored claims.

Every claim it returns carries the passages that support it, the rule terms
that produced its score, and an explicit answer state -- so a reader can see
not just what the corpus says but how firmly it says it.
"""

__all__ = ["provenance", "independence", "paths", "scoring", "schemas", "agent"]
