const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');

const app = express();
const PORT = 4001;

let browser;
let initialResults = [];
let lastPredictions = [];
let lastPlays = [];

app.use(cors());

async function startBrowser() {
    browser = await puppeteer.launch({ headless: true });
}

async function fetchResults() {
    let page;
    try {
        page = await browser.newPage();
        await page.goto('https://blaze1.space/pt/games/double', {
            waitUntil: 'networkidle0',
        });

        const entries = await page.evaluate(() => {
            const entryElements = document.querySelectorAll('.entries.main .entry');
            const results = [];

            entryElements.forEach(entry => {
                const rouletteTile = entry.querySelector('.roulette-tile');
                if (rouletteTile) {
                    const smBox = rouletteTile.querySelector('.sm-box');

                    if (smBox) {
                        const color = smBox.classList.contains('white') ? 'white' :
                            smBox.classList.contains('black') ? 'black' :
                                smBox.classList.contains('red') ? 'red' : null;

                        let number;
                        if (color === 'white') {
                            number = '15x';
                        } else {
                            const numberElement = smBox.querySelector('.number');
                            number = numberElement ? numberElement.textContent.trim() : null;
                        }

                        if (color && number) {
                            results.push({ color, num: number });
                        }
                    }
                }
            });

            return results;
        });

        if (entries.length > 0) {
            const newFirstElement = entries[0];

            // Verifica se a nova jogada é diferente da primeira do histórico
            if (initialResults.length === 0 || 
                newFirstElement.color !== initialResults[0].color || 
                newFirstElement.num !== initialResults[0].num) {
                    
                // Armazena o novo resultado
                initialResults.unshift(newFirstElement);
                lastPlays.unshift(newFirstElement);
                if (lastPlays.length > 40) lastPlays.pop();

                // Preveja o próximo resultado
                if (initialResults.length > 1) {
                    const prediction = proximaPrevisao(initialResults);
                    lastPredictions.unshift({ prediction, result: null, realResult: null }); // Armazena a previsão com resultado inicial null
                    if (lastPredictions.length > 10) lastPredictions.pop();
                }

                // Atualiza o resultado da previsão
                if (lastPredictions.length > 0) {
                    const lastPrediction = lastPredictions[0]; // A previsão mais recente
                    if (lastPrediction) {
                        const resultMatch = newFirstElement.color === lastPrediction.prediction;
                        lastPrediction.result = resultMatch; // Atualiza o resultado
                        lastPrediction.realResult = newFirstElement.color; // Armazena o resultado real
                    }
                }

                console.log('Atualizando resultados e previsões...');
                console.log('Últimas 40 jogadas:', lastPlays);
                console.log('Últimas 10 previsões:', lastPredictions);
            }

        }

    } catch (error) {
        console.error('Erro ao coletar resultados:', error);
    } finally {
        if (page) {
            await page.close();
        }
    }
}

async function collectData() {
    setInterval(fetchResults, 5000);
}

function analisarSequencias(results) {
    let sequencias = {
        red: 0,
        black: 0,
        white: 0
    };
    let ultimaCor = null;
    let maiorSequencia = { cor: null, tamanho: 0 };

    for (let result of results) {
        if (result.color === ultimaCor) {
            sequencias[result.color]++;
            if (sequencias[result.color] > maiorSequencia.tamanho) {
                maiorSequencia = { cor: result.color, tamanho: sequencias[result.color] };
            }
        } else {
            sequencias[result.color] = 1;
            ultimaCor = result.color;
        }
    }

    return { sequencias, maiorSequencia };
}

// Função para prever o próximo resultado
function proximaPrevisao(initialResults) {
    const ultimos10 = initialResults.slice(0, 10);
    const { sequencias, maiorSequencia } = analisarSequencias(ultimos10);

    const ultimaCor = ultimos10[0].color; // A cor do último resultado
    const penultimaCor = ultimos10[1] ? ultimos10[1].color : null; // A cor do penúltimo resultado

    // Contagem de cada cor nos últimos 10 resultados
    const contagem = ultimos10.reduce((acc, result) => {
        acc[result.color]++;
        return acc;
    }, { red: 0, black: 0, white: 0 });

    // Lógica de previsão baseada na análise
    if (maiorSequencia.tamanho >= 3) {
        // Se há uma sequência longa, prevê a quebra
        return maiorSequencia.cor === 'red' ? 'black' : 'red';
    } else if (contagem.white >= 2) {
        // Se houve 2 ou mais brancos recentemente, diminui a chance de outro branco
        return Math.random() < 0.6 ? 'red' : 'black';
    } else if (ultimaCor === penultimaCor) {
        // Se as duas últimas cores são iguais, prevê uma mudança
        return ultimaCor === 'red' ? 'black' : 'red';
    } else {
        // Se não há padrão claro, usa uma abordagem baseada em probabilidade
        const redProbability = (contagem.red + 1) / (ultimos10.length + 2);
        return Math.random() < redProbability ? 'red' : 'black';
    }
}


// Nova rota para as últimas 10 previsões
app.get('/last10Predictions', (req, res) => {
    res.json(lastPredictions);
});

// Nova rota para as últimas 40 jogadas
app.get('/last40Plays', (req, res) => {
    res.json(lastPlays);
});

// Na rota de próxima previsão
app.get('/proximaPrevisao', (req, res) => {
    const previsao = proximaPrevisao(initialResults);
    res.json({ proximaPrevisao: previsao });
});

// Iniciar o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// Inicia o navegador e começa a coleta de dados
startBrowser().then(() => {
    collectData();
});
