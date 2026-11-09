# Modelos de IA e configurações

## Onde ficam as configurações

Abra as **Configurações** a partir da linha no canto inferior esquerdo do ecrã Início e escolha **IA**. O que vê primeiro é a conexão por assinatura. É tudo o que a maioria das pessoas precisa, e tem o seu próprio artigo: [Conexão por assinatura](help://subscription).

Tudo o que requer uma chave fica em **Avançado**, ao fundo da mesma página. Fica fechado até o abrir.

## A predefinição: a sua assinatura

- **IA em uso** começa em **Automático**: das assinaturas conectadas, primeiro o Claude, depois o ChatGPT, depois o Codex.
- O Automático nunca escolhe nada que custe dinheiro extra. Uma chave de API só é usada enquanto escolher por si esse fornecedor em **IA em uso**.
- A lista de modelos ao fundo de cada painel de IA mostra primeiro as assinaturas, depois os fornecedores com chave cuja configuração concluiu. Dentro de uma assinatura, **Modelo padrão** é o modelo normal dessa assinatura.

## Chaves de API (Avançado ▸ Modelo de IA)

Para quem prefere pagar diretamente a um fornecedor, ou executar um modelo próprio.

- Escolha um **Provedor**, introduza a respetiva **Chave de API** (e uma **Base URL** quando o fornecedor a exigir), escolha um **Modelo** e clique em **Salvar**. A lista abrange servidores compatíveis com OpenAI, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud e outros.
- Aqui, a lista **Provedor** só decide de quem são os campos que aparecem no ecrã. Não altera a IA que está em uso; isso é sempre **IA em uso**. Se um provedor guardado não for a IA em uso, aparece em cima **Usar esta IA**; ao carregar, esse provedor passa a ser a **IA em uso**.
- As conversas com um fornecedor com chave usam a sua própria chave, e é esse fornecedor que lhas cobra.
- As chaves ficam guardadas no ficheiro de definições da aplicação nesta máquina e são enviadas apenas nos cabeçalhos dos pedidos.
- **Testar conexão**: confirma que o endpoint está acessível e que o modelo está visível, antes de guardar.
- A URL base pode trazer um caminho e uma cadeia de consulta (ao estilo de gateway); e o caminho do endpoint é acrescentado corretamente.
- Para os servidores que executa por conta própria, podem guardar-se vários **endpoints** e alternar entre eles a qualquer momento.
- **Executável do Codex** serve apenas para um programa Codex instalado num sítio fora do comum. Deixe-o vazio e o programa é encontrado automaticamente.

## O que cada funcionalidade precisa

| Funcionalidade                                                | Com o que funciona                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversa e edição no painel de IA                             | A sua assinatura, ou um fornecedor com chave que escolheu por si.                                                                                                                                                                                                                                                                                                                                 |
| Compreender uma imagem                                        | A IA com que está a conversar olha ela própria para a imagem. Não é precisa nenhuma chave extra. Em Avançado pode escolher-se um fornecedor de análise separado.                                                                                                                                                                                                                                  |
| Gerar uma imagem                                              | **Com a sua assinatura do Codex conectada.** Se escolher um fornecedor de imagens em Avançado ▸ Mídia e busca de IA, ele é usado primeiro. Se o escolhido não puder ser usado, entra o que puder ser usado entre a assinatura do Codex e os fornecedores configurados. Sem nenhum dos dois, a geração de imagens fica indisponível, e o Slides usa em vez disso imagens encontradas por pesquisa. |
| Análise de vídeo e áudio                                      | Um fornecedor com chave que suporte vídeo, escolhido em Avançado ▸ Mídia e busca de IA.                                                                                                                                                                                                                                                                                                           |
| Pesquisa na web e de imagens, leitura de páginas por endereço | Gratuita por predefinição, sem chave. A chave de um fornecedor de pesquisa é opcional.                                                                                                                                                                                                                                                                                                            |
| Pesquisa nos seus próprios ficheiros                          | Corre nesta máquina. Reordenar os resultados através de um serviço é opcional e vem desligado por predefinição.                                                                                                                                                                                                                                                                                   |

Em **Avançado ▸ Mídia e busca de IA**, a chave e o URL base de um fornecedor são introduzidos uma vez e partilhados por todas as funcionalidades que usam esse fornecedor.

## Quando as alterações passam a vigorar

- As alterações de modelo e de endpoint aplicam-se de imediato; uma conversa em curso mantém a configuração antiga até ao turno seguinte.
