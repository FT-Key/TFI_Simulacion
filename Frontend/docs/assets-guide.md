# Assets Guide

## Ubicacion

Sprites normalizados usados por la app:
- `src/assets/sprites/`

## Convenciones

- Nombre en `snake_case`.
- Todos los sprites con extension `.png`.
- Evitar espacios y mayusculas en nombres de archivo.

## Sprites actuales

- `galpon.png`: fondo base de la planta.
- `estaciones.png`: mesa/linea para estaciones.
- `camion.png`: camion de ingreso de dispositivos.
- `empleado_frame1.png` ... `empleado_frame4.png`: animacion de caminata.
- `empleado_derecho.png`, `empleado_izquierdo.png`, `empleado_frente.png`, `empleado_espalda.png`: poses base.
- `impresora_blanca.png`, `impresora_negra.png`, `impresora_oficina.png`, `impresora_gigante.png`: cola/objetos de proceso.

## Agregar nuevos sprites

1. Exportar PNG en resolucion consistente con el estilo pixel art.
2. Guardar con nombre normalizado en `src/assets/sprites/`.
3. Importar en el componente correspondiente (`PlantScene` u otro).
4. Verificar escala final y `image-rendering` para mantener nitidez.

## Notas

- Los PSD originales pueden mantenerse en raiz como fuentes de edicion, pero la app debe consumir solo PNG optimizados.
- `galpon.png` se usa como capa superior de escena para que las ventanas transparentes dejen ver el camion por detras.
- Para preservar encuadre del arte, la escena se renderiza en 16:9 y los offsets de sprites son porcentuales.
