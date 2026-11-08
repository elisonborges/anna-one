-- AnnA Classroom v0.1 — esquema isolado para Neon PostgreSQL
-- Executado no projeto anna-one em 2026-11-07; sem inserir dados.
-- NUNCA usar estas tabelas diretamente no navegador; API autenticada obrigatória.
CREATE SCHEMA IF NOT EXISTS anna_classroom;

CREATE TABLE IF NOT EXISTS anna_classroom.classes (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
institution_id uuid NOT NULL REFERENCES public.institutions(id),
name text NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
school_year integer NOT NULL CHECK(school_year BETWEEN 2020 AND 2200),
created_by uuid NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
updated_at timestamptz NOT NULL DEFAULT now(),
UNIQUE (id,institution_id)
);

CREATE TABLE IF NOT EXISTS anna_classroom.students (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
institution_id uuid NOT NULL REFERENCES public.institutions(id),
display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 150),
created_at timestamptz NOT NULL DEFAULT now(),
UNIQUE(id,institution_id)
);

CREATE TABLE IF NOT EXISTS anna_classroom.enrollments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
institution_id uuid NOT NULL REFERENCES public.institutions(id),
class_id uuid NOT NULL,
student_id uuid NOT NULL,
enrolled_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT enroll_class_fk FOREIGN KEY(class_id,institution_id) REFERENCES anna_classroom.classes(id,institution_id) ON DELETE CASCADE,
CONSTRAINT enroll_student_fk FOREIGN KEY(student_id,institution_id) REFERENCES anna_classroom.students(id,institution_id) ON DELETE CASCADE,
UNIQUE(class_id,student_id)
);

CREATE TABLE IF NOT EXISTS anna_classroom.lessons (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
institution_id uuid NOT NULL REFERENCES public.institutions(id),
class_id uuid NOT NULL,
title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 180),
description text NOT NULL DEFAULT '',
created_by uuid NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT lesson_class_fk FOREIGN KEY(class_id,institution_id) REFERENCES anna_classroom.classes(id,institution_id) ON DELETE CASCADE,
UNIQUE(id,institution_id)
);

CREATE TABLE IF NOT EXISTS anna_classroom.assignments (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
institution_id uuid NOT NULL REFERENCES public.institutions(id),
lesson_id uuid NOT NULL,
title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 180),
instructions text NOT NULL DEFAULT '',
due_at timestamptz,
created_by uuid NOT NULL,
created_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT assignment_lesson_fk FOREIGN KEY(lesson_id,institution_id) REFERENCES anna_classroom.lessons(id,institution_id) ON DELETE CASCADE,
UNIQUE(id,institution_id)
);

CREATE TABLE IF NOT EXISTS anna_classroom.submissions (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
institution_id uuid NOT NULL REFERENCES public.institutions(id),
assignment_id uuid NOT NULL,
student_id uuid NOT NULL,
answer text NOT NULL DEFAULT '',
feedback text,
grade numeric(5,2) CHECK (grade IS NULL OR grade BETWEEN 0 AND 100),
submitted_at timestamptz NOT NULL DEFAULT now(),
CONSTRAINT submission_assignment_fk FOREIGN KEY(assignment_id,institution_id) REFERENCES anna_classroom.assignments(id,institution_id) ON DELETE CASCADE,
CONSTRAINT submission_student_fk FOREIGN KEY(student_id,institution_id) REFERENCES anna_classroom.students(id,institution_id) ON DELETE RESTRICT,
UNIQUE(assignment_id,student_id)
);

CREATE INDEX IF NOT EXISTS classes_by_institution ON anna_classroom.classes(institution_id);

CREATE INDEX IF NOT EXISTS students_by_institution ON anna_classroom.students(institution_id);

CREATE INDEX IF NOT EXISTS enrollments_by_institution ON anna_classroom.enrollments(institution_id,class_id);

CREATE INDEX IF NOT EXISTS lessons_by_institution ON anna_classroom.lessons(institution_id,class_id);

CREATE INDEX IF NOT EXISTS assignments_by_institution ON anna_classroom.assignments(institution_id,lesson_id);

CREATE INDEX IF NOT EXISTS submissions_by_institution ON anna_classroom.submissions(institution_id,assignment_id);

REVOKE ALL ON SCHEMA anna_classroom FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA anna_classroom FROM PUBLIC;
