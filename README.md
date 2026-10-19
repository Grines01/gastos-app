# Mis gastos

App personal de gastos e ingresos. Funciona en el teléfono como app instalada (PWA), sin servidor: los datos viven solo en el dispositivo.

## Qué hace

- Carga rápida: monto, tocás una categoría y queda guardado.
- Gastos, ingresos y transferencias entre cuentas.
- Categorías (de gastos y de ingresos), etiquetas y cuentas con saldo.
- Montos en pesos o dólares, con cotización automática (MEP, oficial, blue o cripto) editable.
- Vista por día, semana, mes, año o período, con torta por categoría.
- Resumen: gasto acumulado del mes contra el anterior, ingresos y gastos de 12 meses, etiquetas y saldos.
- Importación de extractos con revisión antes de guardar:
  - Excel de "Últimos movimientos" de Santander.
  - Reporte de liquidaciones de Mercado Pago (.xlsx o .csv).
  - Export de Gestor de gastos (para migrar el historial).
  - CSV simple: `fecha;monto;descripcion` y opcionales `tipo;moneda;cotizacion;cuenta;categoria;etiquetas`.
- Detecta lo que ya cargaste a mano (mismo monto ±4 días, o ±2% el mismo día, o un pago que cargaste en dos partes) para no duplicar.
- Aprende reglas: lo que corregís al importar, y lo que coincide con tus cargas, se aplica la próxima vez.
- Pantalla "Sin categoría": lo importado que quedó sin categoría, con atajos de un toque, selección múltiple y "recordar para este comercio".
- Resumen: proyección de cierre de mes, tasa de ahorro, gasto variable por día, peso de los fijos, comparación en dólares (MEP promedio del mes), categorías por encima de lo habitual, gastos más grandes y meses cubiertos por tus saldos.
- Backup a archivo JSON y export a CSV (se puede reimportar sin pérdidas).

## Desarrollo

```bash
npm install
npm run dev      # servidor local
npm run build    # genera dist/
```

Cada push a `main` compila y publica en la rama `gh-pages` (GitHub Actions). En el repositorio: Settings → Pages → Source: "Deploy from a branch", rama `gh-pages`, carpeta `/ (root)`.

## Datos

Todo se guarda en IndexedDB del navegador. No hay servidor ni cuentas. Hacé backups desde Más → Backup y datos.

Cotizaciones: [dolarapi.com](https://dolarapi.com) (del día) y [argentinadatos.com](https://argentinadatos.com) (históricas).
