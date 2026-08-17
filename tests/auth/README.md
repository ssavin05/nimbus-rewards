# Pruebas de autenticación — FASE 02

```bash
node tests/auth/index.mjs                 # todo: API + navegador
node tests/auth/index.mjs --estricto      # para CI: una omitida también falla
node tests/auth/index.mjs --sin-navegador # sólo API, sin Playwright
node tests/auth/navegador.mjs             # sólo navegador
```

El informe se imprime y además se guarda en `docs/FASE-02-SALIDA.txt`.

## Códigos de salida

| Código | Significa |
|---|---|
| `0` | Todo lo ejecutado pasó |
| `1` | Al menos un `FALLA` o `ERROR` |
| `2` | Modo `--estricto` y quedaron pruebas `OMITIDA` |

Un `FALLA` manda sobre un `OMITIDA`: si hay las dos cosas, sale `1`.

> **Una prueba `OMITIDA` nunca cuenta como aprobada.** El resumen las
> lista aparte y `--estricto` las trata como fallo. Es el modo que hay
> que usar para afirmar que la fase está cerrada.

## Qué necesita cada cosa

| Requisito | Sin él |
|---|---|
| Nada | 12 casos se ejecutan siempre |
| `SUPABASE_SERVICE_ROLE_KEY` | 12 casos salen `OMITIDA` |
| `CORREO_CONOCIDO` | `AUTH-07b` sale `OMITIDA` |
| Playwright + la app en `:8099` | Los 4 del navegador salen `OMITIDA` |

```bash
export SUPABASE_SERVICE_ROLE_KEY=...            # nunca en el navegador ni en git
export CORREO_CONOCIDO=alguien@ya-registrado.com
python3 -m http.server 8099 &
node tests/auth/index.mjs
```

También valen en un `.env` en la raíz, que ya está en `.gitignore`.

La llave de servicio se usa para `auth.admin`: crear cuentas de prueba
**sin mandar correo** y pedir con `generateLink()` los enlaces que
normalmente llegarían al buzón. Se lee del entorno y nunca se imprime.

## Automático · Navegador · Manual

Esto responde a «¿por qué el runner tiene menos `caso(...)` que filas la
matriz?». Ya no: los del navegador se registran en el **mismo catálogo**,
así que el informe y la matriz coinciden. Lo único que queda fuera es lo
que ninguna máquina puede firmar.

### 🤖 Automático — API (19 casos)

| Grupo | Casos |
|---|---|
| RLS y Auth sin sesión | `07b` `17` `18` `19` `20` `21` |
| Registro | `01` `02` `03` `03b` `04` |
| Confirmación y login | `05` `06` `07` `08` |
| Recuperación | `12` `12b` `13` |
| Roles y multiempresa | `14` `15` |
| Abuso y límites | `16a` `16b` `16c` |

### 🌐 Automático — navegador (4 casos)

`02c` validación del formulario · `09` persistencia · `10` logout ·
`11` sesión expirada.

Necesitan Chromium y la app servida. Si falta cualquiera de los dos,
salen `OMITIDA` con el motivo, no `FALLA`.

### 🖐 Manual — 1 caso, y no se puede automatizar

**Entrega real del correo.** `generateLink()` demuestra que la *lógica*
funciona: que el enlace confirma, que cambia la contraseña, que caduca.
No demuestra que el correo **llegue**.

Hay que comprobar a mano, una vez antes de producción:

- [ ] Llega a la bandeja de entrada
- [ ] El remitente es el correcto (no `noreply@mail.app.supabase.io`)
- [ ] La plantilla está en español y con la marca
- [ ] El enlace abre la app, no una pantalla de error
- [ ] La redirección lleva a donde toca
- [ ] Caduca cuando dice que caduca
- [ ] Funciona desde el móvil
- [ ] **No cae en spam**

Ningún `PASS` de este arnés cubre eso. Por eso el resumen dice
«falta sólo la comprobación manual de entrega de correo» aunque salga
0 fallos.

## Limpieza

Cada caso borra lo suyo al terminar, pase o falle. Además, el runner
**barre al empezar y al acabar** todas las cuentas cuyo correo empiece
por `co-prueba-auth`, por si una tanda anterior se cortó a medias. Si
algo sobrevive, lo avisa y da la sentencia para borrarlo.

Comprobado: dos ejecuciones seguidas dan exactamente el mismo resultado.

## Cómo añadir un caso

```js
import { caso, grupo, exigir } from "./_comun.mjs";

grupo("Mi área");                    // etiqueta para el resumen

caso("AUTH-99", "Lo que sea", "A", async ({ limpiar }) => {
  const u = await crearUsuarioListo();
  limpiar(() => borrarUsuario(u.id));   // se ejecuta pase lo que pase
  exigir(condicion, "qué salió mal si no se cumple");
  return "detalle que sale en el informe";
});
```

- `exigir()` / `exigirIgual()` → `FALLA`
- `throw new OmitirPrueba("motivo")` → `OMITIDA`
- Cualquier otra excepción → `ERROR`

Comprueba siempre **el efecto**, no que la llamada respondiera. Un
`generateLink()` que devuelve una URL no prueba nada hasta que se sigue
la URL y se mira que el estado cambió.
