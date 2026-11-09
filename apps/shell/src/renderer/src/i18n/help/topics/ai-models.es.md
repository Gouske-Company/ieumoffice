# Modelos de IA y ajustes

## Dónde están los ajustes

Abra **Configuración** desde la fila de la parte inferior izquierda de Inicio y elija **IA**. Lo primero que se ve es la conexión por suscripción. Es todo lo que necesita la mayoría, y tiene su propio artículo: [Conexión por suscripción](help://subscription).

Todo lo que requiere una clave está en **Avanzado**, al final de la misma página. Permanece cerrado hasta que usted lo abre.

## Lo predeterminado: su suscripción

- **IA que se usa** empieza en **Automático**: de las suscripciones conectadas, primero Claude, después ChatGPT y después Codex.
- Automático nunca elige nada que cueste dinero adicional. Una clave de API solo se usa mientras usted mismo elija ese proveedor en **IA que se usa**.
- La lista de modelos de la parte inferior de cada panel de IA muestra primero las suscripciones y después los proveedores con clave que haya terminado de configurar. Dentro de una suscripción, **Modelo predeterminado** es el modelo estándar de esa suscripción.

## Claves de API (Avanzado ▸ Modelo de IA)

Para quien prefiera pagar directamente a un proveedor o ejecutar un modelo propio.

- Elija un **Proveedor**, introduzca su **Clave de API** (y una **Base URL** si el proveedor la necesita), elija un **Modelo** y pulse **Guardar**. La lista incluye servidores compatibles con OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud y más.
- Aquí la lista **Proveedor** solo decide de quién son los campos que se ven en pantalla. No cambia qué IA se está usando; eso lo decide siempre **IA que se usa**. Si un proveedor guardado no es la IA en uso, arriba aparece **Usar esta IA**; al pulsarlo, ese proveedor pasa a ser la **IA que se usa**.
- Los chats con un proveedor con clave usan su propia clave, y ese proveedor se los cobra.
- Las claves se guardan en el archivo de ajustes de la aplicación en este equipo y se envían solo en las cabeceras de la petición.
- **Probar conexión**: comprueba que el endpoint sea accesible y que el modelo esté visible antes de guardar.
- Las URL base pueden llevar una ruta y una cadena de consulta (estilo pasarela); las rutas del endpoint se concatenan correctamente.
- Para los servidores que usted mismo ejecuta se pueden guardar varios **endpoints** y cambiar entre ellos en cualquier momento.
- **Ejecutable de Codex** es solo para un programa Codex instalado en un lugar poco habitual. Déjelo vacío y el programa se encuentra automáticamente.

## Qué necesita cada función

| Función                                                      | Con qué funciona                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat y edición en el panel de IA                             | Su suscripción, o un proveedor con clave que usted mismo eligió.                                                                                                                                                                                                                                                                                                                                    |
| Entender una imagen                                          | La IA con la que está chateando mira la imagen por sí misma. No hace falta ninguna clave adicional. En Avanzado se puede elegir un proveedor de análisis aparte.                                                                                                                                                                                                                                    |
| Generar una imagen                                           | **Con su suscripción de Codex conectada.** Si elige un proveedor de imágenes en Avanzado ▸ Medios de IA y búsqueda, ese se usa primero. Si el elegido no se puede usar, lo sustituye lo que se pueda usar entre la suscripción de Codex y los proveedores configurados. Sin ninguno, la generación de imágenes no está disponible, y Slides usa en su lugar imágenes encontradas mediante búsqueda. |
| Análisis de vídeo y audio                                    | Un proveedor con clave que admita vídeo, elegido en Avanzado ▸ Medios de IA y búsqueda.                                                                                                                                                                                                                                                                                                             |
| Búsqueda web y de imágenes, lectura de páginas por dirección | Gratuita de forma predeterminada, sin clave. La clave de un proveedor de búsqueda es opcional.                                                                                                                                                                                                                                                                                                      |
| Búsqueda en sus propios archivos                             | Se ejecuta en este equipo. Reordenar los resultados mediante un servicio es opcional y está desactivado de forma predeterminada.                                                                                                                                                                                                                                                                    |

En **Avanzado ▸ Medios de IA y búsqueda**, la clave y la URL base de un proveedor se introducen una vez y las comparten todas las funciones que usan ese proveedor.

## Cuándo se aplican los cambios

- Los cambios de modelo y de endpoint se aplican de inmediato; una conversación en curso mantiene la configuración anterior hasta su siguiente vuelta.
