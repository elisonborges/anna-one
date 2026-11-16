-- v0.1.14: cards de projetos com cor e responsáveis.
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS card_color text NOT NULL DEFAULT 'blue';
ALTER TABLE teamhub.projects ADD COLUMN IF NOT EXISTS owner_subject text;
ALTER TABLE teamhub.projects ADD CONSTRAINT project_card_color_allowed CHECK (card_color IN ('blue','violet','green','orange','pink','teal','slate'));
