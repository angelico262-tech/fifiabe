# FIFIABE

Application de réservation de taxi-brousse pour la ligne Antananarivo ↔ SAVA. Le dépôt est un monorepo pnpm avec `backend/` Fastify + Prisma et `frontend/` Preact + Vite + Tailwind. Aucun conteneur Docker n’est nécessaire.

## Installation

Installez Node.js 20 ou supérieur, puis pnpm : `corepack enable` et `corepack prepare pnpm@9 --activate`. Dans Supabase, créez un projet PostgreSQL, ouvrez **Project Settings → Database**, puis copiez l’URI de connexion dans `backend/.env` à partir de `backend/.env.example`. Générez un secret JWT d’au moins 32 caractères et ne commitez jamais `.env`.

Depuis la racine : `pnpm install`. Ensuite : `cd backend`, `pnpm prisma:generate`, `pnpm prisma:migrate --name init`, puis `pnpm seed`. Lancez le backend avec `pnpm dev`. Dans un second terminal, depuis la racine, lancez `pnpm --filter @fifiabe/frontend dev`, puis ouvrez http://localhost:5173. Le backend écoute uniquement sur http://127.0.0.1:3000 et `/health` renvoie `{ "status": "ok" }`.

Le seed crée l’administrateur `admin@fifiabe.mg`, un chauffeur test, les deux directions, les arrêts dans l’ordre métier, neuf véhicules FIF-001 à FIF-009 et les départs des mardis, jeudis et samedis des quatre prochaines semaines, à 13h00, pour chaque véhicule et chaque sens.
