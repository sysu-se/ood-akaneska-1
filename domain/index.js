import { solveSudoku, getCandidates } from '@mattflow/sudoku-solver';

// ========== Sudoku 类（扩展提示能力）==========
class Sudoku {
  constructor(initialGrid) {
    // 深拷贝初始网格，避免引用污染
    this.grid = JSON.parse(JSON.stringify(initialGrid));
  }

  // 获取9x9网格（原有方法）
  getGrid() {
    return JSON.parse(JSON.stringify(this.grid));
  }

  // 填写数字（原有方法）
  guess({ row, col, value }) {
    if (row < 0 || row >= 9 || col < 0 || col >= 9 || value < 0 || value > 9) {
      throw new Error('Invalid move: out of bounds or invalid value');
    }
    this.grid[row][col] = value;
  }

  // 深拷贝（原有方法）
  clone() {
    return new Sudoku(this.getGrid());
  }

  // 序列化（原有方法）
  toJSON() {
    return { grid: this.getGrid() };
  }

  // 【新增】获取指定单元格的候选数
  getCellCandidates({ row, col }) {
    if (this.grid[row][col] !== 0) return []; // 已填数字无候选数
    return getCandidates(this.grid, row, col);
  }

  // 【新增】获取下一步可填写的推定数（唯一候选值的单元格）
  getNextHint() {
    for (let row = 0; row < 9; row++) {
      for (let col = 0; col < 9; col++) {
        if (this.grid[row][col] !== 0) continue;
        const candidates = this.getCellCandidates({ row, col });
        if (candidates.length === 1) {
          return { row, col, value: candidates[0], reason: `该单元格唯一候选数为 ${candidates[0]}` };
        }
      }
    }
    return null; // 无唯一推定数，需进入探索模式
  }

  // 【新增】检查棋盘是否冲突（探索模式失败判定）
  hasConflict() {
    // 检查行、列、3x3宫是否有重复数字
    const checkDuplicate = (arr) => {
      const nums = arr.filter(n => n !== 0);
      return new Set(nums).size !== nums.length;
    };

    // 检查行
    for (let row = 0; row < 9; row++) {
      if (checkDuplicate(this.grid[row])) return true;
    }

    // 检查列
    for (let col = 0; col < 9; col++) {
      const column = this.grid.map(row => row[col]);
      if (checkDuplicate(column)) return true;
    }

    // 检查3x3宫
    for (let boxRow = 0; boxRow < 3; boxRow++) {
      for (let boxCol = 0; boxCol < 3; boxCol++) {
        const box = [];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            box.push(this.grid[boxRow * 3 + r][boxCol * 3 + c]);
          }
        }
        if (checkDuplicate(box)) return true;
      }
    }
    return false;
  }

  // 字符串化（原有方法）
  toString() {
    return this.grid.map(row => row.join(' ')).join('\n');
  }

  // 反序列化（原有静态方法）
  static fromJSON(json) {
    return new Sudoku(json.grid);
  }
}

// ========== Game 类（扩展探索模式）==========
class Game {
  constructor({ sudoku }) {
    this.baseSudoku = sudoku.clone(); // 主局面基准
    this.currentSudoku = sudoku.clone(); // 当前活跃局面
    this.history = []; // 主历史栈（原有）
    this.redoStack = []; // 重做栈（原有）
    this.exploreState = null; // 探索模式状态：{ startSnapshot, history, failedPaths }
    this.failedPaths = new Set(); // 记忆失败的探索路径
  }

  // 获取当前Sudoku（原有方法）
  getSudoku() {
    return this.currentSudoku.clone();
  }

  // 填写数字（原有方法，兼容探索模式）
  guess(move) {
    // 清空重做栈（原有逻辑）
    this.redoStack = [];

    // 如果处于探索模式，写入探索历史
    if (this.isInExploreMode()) {
      this.exploreState.history.push(this.currentSudoku.clone());
      this.currentSudoku.guess(move);
      
      // 检查是否命中失败路径
      const pathKey = this._getGridKey(this.currentSudoku.getGrid());
      if (this.failedPaths.has(pathKey)) {
        throw new Error('该探索路径已失败，无需重复尝试');
      }

      // 检查冲突，记录失败路径
      if (this.currentSudoku.hasConflict()) {
        this.failedPaths.add(pathKey);
        throw new Error('探索失败：棋盘出现冲突');
      }
      return;
    }

    // 非探索模式，写入主历史（原有逻辑）
    this.history.push(this.currentSudoku.clone());
    this.currentSudoku.guess(move);
  }

  // 撤销（原有方法，兼容探索模式）
  undo() {
    if (this.isInExploreMode()) {
      if (this.exploreState.history.length === 0) return false;
      this.currentSudoku = this.exploreState.history.pop();
      return true;
    }

    // 非探索模式，执行原有Undo
    if (this.history.length === 0) return false;
    this.redoStack.push(this.currentSudoku.clone());
    this.currentSudoku = this.history.pop();
    return true;
  }

  // 重做（原有方法，兼容探索模式）
  redo() {
    if (this.isInExploreMode()) return false; // 探索模式不支持Redo（避免分支混乱）
    if (this.redoStack.length === 0) return false;
    this.history.push(this.currentSudoku.clone());
    this.currentSudoku = this.redoStack.pop();
    return true;
  }

  // 能否撤销（原有方法）
  canUndo() {
    if (this.isInExploreMode()) {
      return this.exploreState.history.length > 0;
    }
    return this.history.length > 0;
  }

  // 能否重做（原有方法）
  canRedo() {
    return !this.isInExploreMode() && this.redoStack.length > 0;
  }

  // 【新增】进入探索模式
  enterExploreMode() {
    if (this.isInExploreMode()) return;
    // 记录探索起点快照、独立历史栈
    this.exploreState = {
      startSnapshot: this.currentSudoku.clone(),
      history: []
    };
  }

  // 【新增】退出探索模式（提交结果）
  commitExplore() {
    if (!this.isInExploreMode()) return false;
    // 将探索结果合并到主历史
    this.history.push(this.exploreState.startSnapshot.clone()); // 记录探索起点
    this.redoStack = []; // 清空重做栈
    this.baseSudoku = this.currentSudoku.clone(); // 更新主局面
    this.exploreState = null; // 退出探索模式
    return true;
  }

  // 【新增】放弃探索模式（回滚到起点）
  abortExplore() {
    if (!this.isInExploreMode()) return false;
    this.currentSudoku = this.exploreState.startSnapshot.clone(); // 回滚到探索起点
    this.exploreState = null; // 退出探索模式
    return true;
  }

  // 【新增】判断是否处于探索模式
  isInExploreMode() {
    return !!this.exploreState;
  }

  // 【新增】生成网格唯一标识（用于记忆失败路径）
  _getGridKey(grid) {
    return grid.flat().join(',');
  }

  // 序列化（原有方法，扩展探索状态）
  toJSON() {
    return {
      baseSudoku: this.baseSudoku.toJSON(),
      currentSudoku: this.currentSudoku.toJSON(),
      history: this.history.map(s => s.toJSON()),
      redoStack: this.redoStack.map(s => s.toJSON()),
      exploreState: this.exploreState ? {
        startSnapshot: this.exploreState.startSnapshot.toJSON(),
        history: this.exploreState.history.map(s => s.toJSON())
      } : null,
      failedPaths: Array.from(this.failedPaths)
    };
  }

  // 反序列化（原有静态方法，扩展探索状态）
  static fromJSON(json) {
    const baseSudoku = Sudoku.fromJSON(json.baseSudoku);
    const game = new Game({ sudoku: baseSudoku });
    game.currentSudoku = Sudoku.fromJSON(json.currentSudoku);
    game.history = json.history.map(s => Sudoku.fromJSON(s));
    game.redoStack = json.redoStack.map(s => Sudoku.fromJSON(s));
    if (json.exploreState) {
      game.exploreState = {
        startSnapshot: Sudoku.fromJSON(json.exploreState.startSnapshot),
        history: json.exploreState.history.map(s => Sudoku.fromJSON(s))
      };
    }
    game.failedPaths = new Set(json.failedPaths);
    return game;
  }
}

// 工厂函数（原有接口，保持兼容）
export function createSudoku(initialGrid) {
  return new Sudoku(initialGrid);
}

export function createSudokuFromJSON(json) {
  return Sudoku.fromJSON(json);
}

export function createGame({ sudoku }) {
  return new Game({ sudoku });
}

export function createGameFromJSON(json) {
  return Game.fromJSON(json);
}