"""unique course version per course

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint(
        "course_version_uniq",
        "course_versions",
        ["course_id", "version"],
    )


def downgrade() -> None:
    op.drop_constraint("course_version_uniq", "course_versions", type_="unique")
