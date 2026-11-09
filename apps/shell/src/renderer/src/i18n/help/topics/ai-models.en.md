# AI models and settings

## Where the settings are

Open **Settings** from the row at the bottom left of Home and choose **AI**. What you see first is the subscription connection. That is all most people need, and it has its own article: [Subscription connection](help://subscription).

Everything that takes a key is under **Advanced**, at the bottom of the same page. It stays closed until you open it.

## The default: your subscription

- **AI to use** starts on **Automatic**: of the subscriptions that are connected, Claude first, then ChatGPT, then Codex.
- Automatic never picks anything that costs extra money. An API key is used only while you choose that provider yourself under **AI to use**.
- The model list at the bottom of each AI panel shows the subscriptions first, then the key providers you have finished setting up. Under a subscription, **Default model** is the standard model for that subscription.

## API keys (Advanced ▸ AI Model)

For people who would rather pay a provider directly, or run a model of their own.

- Choose a **Provider**, enter its **API Key** (and a **Base URL** where the provider needs one), pick a **Model**, then press **Save**. The list covers OpenAI-compatible servers, Anthropic, Gemini, DeepSeek, DashScope (qwen), Atlas Cloud and more.
- The **Provider** list here only decides whose fields are on screen. It does not change which AI is in use; that is always **AI to use**. When a provider you saved is not the AI in use, **Use this AI** appears at the top; pressing it makes that provider the **AI to use**.
- Chats on a key provider use your own key, and that provider charges you for them.
- Keys are stored in the app's settings file on this machine and sent only in request headers.
- **Test connection**: verify endpoint reachability and model visibility before saving.
- Base URLs may carry a path and query string (gateway-style); endpoint paths are appended correctly.
- For servers you run yourself, several **endpoints** can be saved and switched between at any time.
- **Codex executable** is only for a Codex program installed in an unusual place. Leave it empty and the program is found automatically.

## Which feature needs what

| Feature                                             | What it runs on                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat and editing in the AI panel                    | Your subscription, or a key provider you chose yourself.                                                                                                                                                                                                                                                                                                               |
| Understanding a picture                             | The AI you are chatting with looks at the picture itself. No extra key is needed. A separate analysis provider can be chosen under Advanced.                                                                                                                                                                                                                           |
| Generating a picture                                | **Your connected Codex subscription.** If you choose an image provider under Advanced ▸ AI Media & Search, that one comes first. When the chosen one cannot be used, whichever of the Codex subscription and your configured providers can be used takes its place. Without either, image generation is unavailable, and Slides uses pictures found by search instead. |
| Video and audio analysis                            | A key provider that supports video, chosen under Advanced ▸ AI Media & Search.                                                                                                                                                                                                                                                                                         |
| Web and image search, reading a page by its address | Free by default, with no key. A search provider key is optional.                                                                                                                                                                                                                                                                                                       |
| Search inside your own files                        | Runs on this machine. Reranking the results through a service is optional and off by default.                                                                                                                                                                                                                                                                          |

Under **Advanced ▸ AI Media & Search**, a provider's key and base URL are entered once and shared by every feature that uses that provider.

## When changes apply

- Model and endpoint changes apply immediately; an in-flight conversation keeps the old configuration until its next turn.
