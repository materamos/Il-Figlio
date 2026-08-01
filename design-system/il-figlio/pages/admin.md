# Admin override

The admin inherits the Il Figlio palette and typography. It increases information density while remaining phone-first.

## Layout

- Max width: 1040px.
- Single-column below 768px; two-column operational dashboard above 1024px where useful.
- Persistent top summary for session, publication state, and global business status.
- Primary sections: Estado, Disponibilidad, Carta, Publicación, Cuenta.
- Use native controls and fieldsets; avoid custom switch widgets when a checkbox communicates the state clearly.

## Controls

- Input minimum height: 44px; body size at least 16px on mobile.
- Visible label for every field and helper text for price format.
- Numeric prices use `inputmode="numeric"` and tabular figures.
- Validate on blur, then again on submit.
- Async buttons expose loading, success, and recoverable error states.
- Destructive actions are separated spatially and require confirmation.
- Archive actions remain reversible through an Eliminados section.

## Semantic admin colors

The brand palette remains dominant. Semantic colors appear only in small status indicators and always include text.

| Role | Value |
| --- | --- |
| Success | `#166534` |
| Warning | `#8A4B08` |
| Error | `#9F1239` |
| Info | `#334155` |

## Motion and feedback

- 150–200ms transitions.
- No scroll reveal or decorative entrance animation.
- Preserve form values and focus during network activity.
- Success messages use `aria-live="polite"`; blocking errors use `role="alert"`.
- After validation failure, focus the first invalid field.
