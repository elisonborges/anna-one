-- AnnA Flow v1.5.11: permitir sete temas visuais em Painéis de TV.
-- Compatível com valores já cadastrados. Aplicar ANTES de publicar os novos seletores.
-- Não altera registros existentes.
BEGIN;
ALTER TABLE flow_signage_profiles DROP CONSTRAINT flow_signage_profiles_theme_check;
ALTER TABLE flow_signage_profiles ADD CONSTRAINT flow_signage_profiles_theme_check
 CHECK (theme IN ('escuro','claro','acolhedor','azul','verde','vinho','roxo'));
COMMIT;
