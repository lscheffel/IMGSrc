# STYLEGUIDE

## TypeScript
- `strict` habilitado; sem `any` implícito.
- Prefira `type` para DTOs e `zod` para validação de entrada.
- Erros devem retornar payload padronizado `{ error, details? }`.

## React + Zustand
- Estado de domínio em store; componente só orquestra UI.
- Side effects centralizados em actions assíncronas.

## Vue
- Uso como custom element isolado para widgets reutilizáveis.

## API
- Rotas em `/api/*`.
- Nunca retornar stack trace ao cliente.

## CSS
- Tailwind utility-first.
- Evitar CSS global fora de `styles.css`.

