/// STOLEN SHIT

function getRandomArbitrary(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min);
}
/////////

let gameInterval;
let gameActive = false;

function createNewGame(rowCount, columnCount) {

    let emptyArr = [];
    let snakeHeadSpawn = getRandomArbitrary(1, rowCount * columnCount);

    for (i = 1; i <= rowCount * columnCount; i++)
        if (i !== snakeHeadSpawn)
            emptyArr.push(i);

    let newGame = {
        "rowCount": rowCount,
        "columnCount": columnCount,
        "empty": emptyArr,
        "snake": [],
        "fruit": [],
        "snakeHead": snakeHeadSpawn,
        "snakeDirection": 0        //0=stop 1=UP 2=RIGHT 3=DOWN 4=LEFT
    }
    document.querySelector(':root').style.setProperty('--column-count', columnCount);
    document.querySelector(':root').style.setProperty('--row-count', rowCount);
    return newGame;
}

function updateTable(game) {
    let gameTable = document.getElementById("game-table");
    gameTable.innerHTML = '';

    for (cell = 1; cell <= game.rowCount * game.columnCount; cell++) {
        let temp = document.createElement("div");
        if (game.empty.indexOf(cell) !== -1) {
            temp.classList.add("empty-cell");
        }
        if (game.snake.indexOf(cell) !== -1) {
            temp.classList.add("snake-cell");
        }
        if (game.fruit.indexOf(cell) !== -1) {
            temp.classList.add("fruit-cell");
        }
        if (cell === game.snakeHead) {
            temp.classList.add("snake-head-cell");
        }
        gameTable.appendChild(temp);
    }
}

function spawnFruit(game) {

    let newFruitCell;

    do {
        newFruitCell = getRandomArbitrary(1, game.rowCount * game.columnCount);
    } while (game.snake.indexOf(newFruitCell) !== -1 || game.fruit.indexOf(newFruitCell) !== -1 || game.snakeHead === newFruitCell)
    game.empty.splice(game.empty.indexOf(newFruitCell), 1);
    game.fruit.push(newFruitCell);

    updateTable(game);
}

function changeDirection(inputDirection) {
    let prevDirection = snakeGame.direction;

    switch (inputDirection) { //0=stop 1=UP 2=RIGHT 3=DOWN 4=LEFT
        case "UP": //1
            if (prevDirection !== 3 && prevDirection !== 1) {
                snakeGame.direction = 1;
                moveSnake(snakeGame);
            }
            break;
        case "RIGHT":   //2
            if (prevDirection !== 4 && prevDirection !== 2) {
                snakeGame.direction = 2;
                moveSnake(snakeGame);
            }
            break;
        case "DOWN": //3
            if (prevDirection !== 1 && prevDirection !== 3) {
                snakeGame.direction = 3;
                moveSnake(snakeGame);
            }
            break;
        case "LEFT": //4
            if (prevDirection !== 2 && prevDirection !== 4) {
                snakeGame.direction = 4;
                moveSnake(snakeGame);
            }
            break;
        default:
            console.log("ERROR: Invalid direction: " + inputDirection + " , stopping snake");
            snakeGame.direction = 0;
            return;
    }
    
        

}

function moveSnake(game) {

    let currPosition = snakeGame.snakeHead;
    let nextPosition;
    switch (snakeGame.direction) { //0=stop 1=UP 2=RIGHT 3=DOWN 4=LEFT
        case 1: //UP
            nextPosition = parseInt(currPosition) - parseInt(snakeGame.columnCount);
            break;
        case 2: //RIGHT
            nextPosition = parseInt(currPosition) + 1;
            break;
        case 3: //DOWN
            nextPosition = parseInt(currPosition) + parseInt(snakeGame.columnCount);
            break;
        case 4: //LEFT
            nextPosition = parseInt(currPosition) - 1;
            break;
        default:
            return;
    }

    if (checkForWin(game) || checkForCollision(game, currPosition, nextPosition))
        return;

    if (game.fruit.indexOf(nextPosition) !== -1) {
        game.fruit.splice(game.fruit.indexOf(nextPosition), 1);
        game.snake.unshift(currPosition);
        spawnFruit(game);
    }
    else {
        game.empty.splice(game.empty.indexOf(nextPosition), 1);
        
        for (i = snakeGame.snake.length - 1; i >= 0; i--) {
            if (i !== 0)
                snakeGame.snake[i] = snakeGame.snake[i - 1];
            else
                snakeGame.snake[i] = currPosition;
    }
    } game.empty.push(currPosition);
    game.snakeHead = nextPosition;

    

    updateTable(game);
}


function checkForCollision(game, currPosition, nextPosition) {
    if (nextPosition < 0
        || nextPosition > game.columnCount * game.rowCount
        || game.snake.indexOf(nextPosition) !== -1
        || (currPosition % game.columnCount === 0  && nextPosition  === currPosition+1)
        || (currPosition % game.columnCount === 1 && nextPosition  === currPosition-1)) {
        gameActive = false;
        console.log("fail, moved from " + currPosition + " to " + nextPosition + " which isn't allowed :P");

        document.getElementById("win-or-lose").innerText = "you lost... ";
        clearInterval(gameInterval);
            
    let gameTable = document.getElementById("game-table");
    gameTable.innerHTML = '';

        return true;

    }
    return false;
}

function checkForWin(game) {
    if (game.snake.length + 1 === game.rowCount * game.columnCount) {
        gameActive = false;
        console.log("win");

        document.getElementById("win-or-lose").innerText = "you won... ";
        clearInterval(gameInterval);
        
    let gameTable = document.getElementById("game-table");
    gameTable.innerHTML = '';
        return true;
    }
    return false;
}




document.getElementById("start-button").addEventListener("click", function () {
    gameActive = true;
    document.getElementById("win-or-lose").innerText = "";
    size=document.getElementById("start-size").value;
    console.log(size);
    snakeGame = createNewGame(size, size); 
    spawnFruit(snakeGame);
    console.log(snakeGame);
    gameInterval = setInterval(() => {
        if(gameActive)
            moveSnake(snakeGame);
        }, 2000/size);

})




document.addEventListener('keydown', function (evt) {
    if (gameActive) {
        if (evt.key == 'ArrowLeft') changeDirection("LEFT");
        if (evt.key == 'ArrowUp') changeDirection("UP");
        if (evt.key == 'ArrowRight') changeDirection("RIGHT");
        if (evt.key == 'ArrowDown') changeDirection("DOWN");
    }
});

document.getElementById("start-size").oninput = function() {
    document.getElementById("size-value").innerHTML = this.value;
    if(!gameActive)
        {
        document.querySelector(':root').style.setProperty('--column-count', this.value);
        document.querySelector(':root').style.setProperty('--row-count', this.value);
    }
        
  } 
