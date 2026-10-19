"""unique course version per course

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-18
"""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {item["name"] for item in inspector.get_unique_constraints("course_versions")}
    if "course_version_uniq" not in existing:
        with op.batch_alter_table("course_versions") as batch:
            batch.create_unique_constraint("course_version_uniq", ["course_id", "version"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {item["name"] for item in inspector.get_unique_constraints("course_versions")}
    if "course_version_uniq" in existing:
        with op.batch_alter_table("course_versions") as batch:
            batch.drop_constraint("course_version_uniq", type_="unique")
