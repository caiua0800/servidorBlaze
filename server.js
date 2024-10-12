const express = require('express');
const cors = require('cors'); // Importa o pacote CORS
const puppeteer = require('puppeteer');

const app = express();
const PORT = 4001;

const cycleCount = 20; // Número de resultados a coletar e prever
const predictionHistorySize = 30; // Tamanho do histórico de previsões
let browser;
let results = []; // Armazena resultados atuais para previsão
let predictionsHistory = []; // Armazena o histórico de previsões
let isSpinning = false; // Variável para monitorar o estado de "girando"
let isFirstResultReceived = false; // Indica se a primeira jogada foi recebida

// Usar CORS
app.use(cors());

// Inicia o navegador
async function startBrowser() {
  browser = await puppeteer.launch({ headless: true });
}

// Função para coletar resultados do jogo
async function fetchResults() {
  let page;
  try {
    page = await browser.newPage();
    await page.goto('https://blaze1.space/pt/games/double', {
      waitUntil: 'networkidle0',
    });

    const gameDetails = await page.evaluate(() => {
      const gameInnerElement = document.querySelector('.game-inner');
      if (!gameInnerElement) {
        return null;
      }

      const timeLeft = gameInnerElement.querySelector('.time-left');
      return {
        timeLeft: timeLeft ? timeLeft.textContent.trim() : null,
      };
    });

    if (!gameDetails || !gameDetails.timeLeft) {
      return; // Não imprimir nada, já que os detalhes são inválidos
    }

    // Verifica se o timer está em "Girando..."
    const timeMatch = gameDetails.timeLeft.match(/Girando em/i);
    if (timeMatch) {
      isSpinning = true; // Defino isSpinning como true
      const timeMatchDetails = gameDetails.timeLeft.match(/Girando em (\d+):(\d+)/);
      if (timeMatchDetails) {
        let [seconds, centiseconds] = timeMatchDetails.slice(1, 3).map(Number);
        let totalSeconds = seconds + Math.floor(centiseconds / 10); // Ajuste para centésimos

        // Contar o tempo restante, mas mudar para "0:00" e imprimir "Girando" após 15 segundos
        await new Promise(resolve => setTimeout(resolve, totalSeconds * 1000));
        
        console.log("\nGirando"); // Imprimir "Girando"
      }
      return; // Aguarda a próxima chamada para coletar o resultado.
    } else {
      isSpinning = false; // Defino isSpinning como false
    }

    // Processar o resultado do jogo se não estiver girando.
    const match = gameDetails.timeLeft.match(/Blaze Girou (\d+)!/);
    if (match) {
      const number = match[1];
      const parentClass = await page.evaluate((number) => {
        const divs = document.querySelectorAll('.number');
        for (let div of divs) {
          if (div.textContent.trim() === number) {
            return div.parentElement.className;
          }
        }
        return null;
      }, number);

      if (parentClass) {
        const classes = parentClass.split(' ');
        const color = classes[classes.length - 1];

        // Adicionar o resultado ao histórico
        if (["white", "red", "black"].includes(color)) {
          if (!isFirstResultReceived) {
            isFirstResultReceived = true; // Mark that the first result has been received
          }
          // Ignorar adição se o resultado for repetido
          const lastResult = results[results.length - 1];
          if (!lastResult || lastResult.number !== number || lastResult.color !== color) {
            results.push({ number, color });
            console.log(`Blaze girou ${color}, ${number}`); // Impressão no formato desejado
            
            // Verificar a previsão
            const latestPrediction = predictionsHistory[predictionsHistory.length - 1];
            if (latestPrediction) {
              latestPrediction.correct = (latestPrediction.prediction === color);
            }
          }
        }
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

async function collectDataAndPredict() {
  while (results.length < cycleCount) {
    await fetchResults();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Espera 1 segundo entre as coletas
  }

  // Calcular previsões com base nos resultados coletados
  const predictions = calculateNextProbabilities(results);

  // Adicionar o histórico de previsões, mantendo o tamanho máximo
  const newPrediction = { prediction: predictions[0], correct: null }; // Inicialmente, a previsão correta é indeterminada
  predictionsHistory.push(newPrediction);
  if (predictionsHistory.length > predictionHistorySize) {
    predictionsHistory.shift(); // Remove a previsão mais antiga
  }
  
  // Imprimir previsões
  console.log(`Próximas ${cycleCount} previsões: ${predictions.join(', ')}`);

  // Iniciar coleta de novos dados enquanto exibe previsões
  results = []; // Limpar resultados para a próxima coleta
  setImmediate(collectDataAndPredict); // Continua o ciclo
}

function calculateNextProbabilities(results) {
  // Cria um dicionário para contar a quantidade de cada cor
  const colorCounts = results.reduce((acc, { color }) => {
    acc[color] = (acc[color] || 0) + 1;
    return acc;
  }, {});

  const total = results.length;
  const probabilitiesPerColor = {};
  
  // Calcular a probabilidade de cada cor
  ["white", "red", "black"].forEach(color => {
    const count = colorCounts[color] || 0;
    probabilitiesPerColor[color] = count / total; // Determina a probabilidade
  });

  // Gera array de previsões para as próximas `cycleCount` rodadas usando distribuição de probabilidade
  const predictions = [];
  for (let i = 0; i < cycleCount; i++) {
    let randomValue = Math.random();
    let cumulativeProb = 0;

    // Escolhe uma cor baseada na distribuição de probabilidades
    for (const color of ["white", "red", "black"]) {
      cumulativeProb += probabilitiesPerColor[color];
      if (randomValue < cumulativeProb) {
        predictions.push(color);
        break;
      }
    }
  }

  return predictions;
}

// Rota para obter as últimas 60 jogadas
app.get('/last-results', (req, res) => {
  const lastResults = results.slice(-60); // Retorna as últimas 60 (ou menos)
  res.json(lastResults);
});

// Rota para obter as previsões geradas
app.get('/predictions', (req, res) => {
  const predictions = predictionsHistory.length > 0 ? predictionsHistory[predictionsHistory.length - 1] : null;
  res.json(predictions ? predictions.prediction : []);
});

// Rota para verificar se está girando ou aguardando
app.get('/status', (req, res) => {
  res.json({ isSpinning });
});

// Rota para obter o histórico de previsões
app.get('/prediction-history', (req, res) => {
  res.json(predictionsHistory);
});

// Iniciar o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});

// Fechar o navegador antes de sair
process.on('exit', async () => {
  if (browser) {
    await browser.close();
    console.log('Navegador fechado.');
  }
});

// Inicia o navegador e começa o ciclo de coletas e previsões
startBrowser().then(() => {
  collectDataAndPredict();
});
