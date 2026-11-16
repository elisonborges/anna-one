-- AnnA Nexus v0.1.31: custom card theme with legacy palette preserved
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS card_theme text;
-- Existing card_color constraint (7 historic colors) remains unchanged.
-- Application validates palette; card_theme stores any of 12 predefined variants.
