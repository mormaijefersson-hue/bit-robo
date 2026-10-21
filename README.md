# 🤖 Bit — robô assistente no Galaxy S8

Rosto animado + ouvido sempre ligado + cérebro (Claude) + voz. Sarcástico, questionador e preguiçoso.

## Como colocar no S8
1. Hospedar a pasta `robo/` num endereço **https** (obrigatório pro microfone): GitHub Pages num repositório público só com esta pasta, ou Netlify Drop (arrastar a pasta em app.netlify.com/drop).
2. No S8, abrir o link no **Chrome** → menu ⋮ → **Adicionar à tela inicial** (abre em tela cheia).
3. Tocar na tela → permitir microfone.
4. Tocar no rosto → engrenagem ⚙ → colar a **chave da API** (console.anthropic.com). Coloque um limite de gasto mensal no console.

## Uso
- Fala perto dele: ele responde sozinho. Desligue "Intrometido" pra ele só responder quando chamarem pelo nome.
- Tocar no rosto: cutuca. Tocar enquanto fala: ele cala.
- Depois de X minutos sem ninguém falar, cochila (tela escurece). Acorda reclamando quando ouve alguém.

## Cuidados com o aparelho
- **Burn-in**: o rosto passeia devagar pela tela e escurece quando dorme, mas AMOLED marca imagem fixa. Brilho no mínimo que der pra ver.
- **Bateria**: carregando 24h, bateria de S8 pode estufar. Use um timer de tomada (ex.: carrega 2h, desliga 4h) ou fique de olho.
- **Bipe do microfone**: o Android pode apitar quando o reconhecimento de voz reinicia. Se incomodar, abaixe o volume de notificações/sistema.

## Teste
Testado em Chromium simulando o S8 (740×360, CPU 4x mais lenta): 20/20 verificações, 61 fps, envio pro cérebro em <10 ms após a frase terminar, começa a falar na primeira frase da resposta.
