# 🤖 Bit — robô assistente no Galaxy S8

Rosto animado + ouvido sempre ligado + cérebro (Claude) + voz. Sarcástico, questionador e preguiçoso.

**Abrir:** https://mormaijefersson-hue.github.io/bit-robo/

## Como colocar no S8
1. Abrir o link no **Chrome** → menu ⋮ → **Adicionar à tela inicial** (abre em tela cheia).
2. Tocar na tela → permitir microfone. Na primeira vez ele baixa o ouvido offline (~36 MB, use Wi-Fi); depois fica guardado.
3. Tocar no rosto → engrenagem ⚙ → colar a **chave da API** (console.anthropic.com). Coloque um limite de gasto mensal no console.

## Uso
- Fala perto dele: ele responde sozinho. Desligue "Intrometido" pra ele só responder quando chamarem pelo nome.
- Tocar no rosto: cutuca. Tocar enquanto fala: ele cala.
- Depois de X minutos sem ninguém falar, cochila (tela escurece). Acorda reclamando quando ouve alguém.

## Ouvido
- **Offline (padrão):** reconhecimento de voz rodando no próprio celular (Vosk, modelo pequeno em português). Microfone fica aberto direto: sem bipe e sem abaixar o volume da voz do robô. Entende um pouco pior que o Google — o cérebro compensa erros pequenos.
- **Google:** entende melhor, mas o Android apita e abaixa o som a cada vez que o reconhecimento reinicia. Troca na engrenagem.

## Cuidados com o aparelho
- **Volume:** a voz sai no volume de **mídia**. Se estiver baixa, aperte o volume e abra o painel (setinha) pra subir "Mídia".
- **Burn-in**: o rosto passeia devagar pela tela e escurece quando dorme, mas AMOLED marca imagem fixa. Brilho no mínimo que der pra ver.
- **Bateria**: carregando 24h, bateria de S8 pode estufar. Use um timer de tomada (ex.: carrega 2h, desliga 4h) ou fique de olho.

## Teste
Simulando o S8 (740×360, CPU 4x mais lenta): 20/20 verificações, 61 fps, envio pro cérebro em <10 ms após a frase terminar, começa a falar na primeira frase da resposta. Ouvido offline testado com fala natural injetada no microfone do Chromium.
