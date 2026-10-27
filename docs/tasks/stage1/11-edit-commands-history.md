---
id: S1-11
title: 編集コマンドと Undo/Redo
status: doing
depends: [S1-09]
---

# S1-11 編集コマンドと Undo/Redo

## 目的
design.md §7「シーンの変更は、必ず core/edit のコマンドを通す（Undo の履歴に積まれる）」の core 側を作る。完了すると、段階 1 のすべての編集（起点、生やす、削除、浮いたシャフトの付け直し、歯数、角度、シャフト上の位置、モーター、シャフトの移動と向き、シーンの差し替え）を、不変のシーンに対する純粋関数として適用でき、Undo/Redo できる。UI（S1-16〜S1-20）はこのコマンドを発行するだけになる。

## 範囲
- コマンドの適用 `applyCommand(scene, command, ctx)`
  - 入力のシーンを変更せず、新しいシーンを返す。変わらない部分は元の参照を使い回す（render が参照の比較で作り直しを決めるため。design.md §7）
  - 何も変わらないコマンド（同じ歯数を設定するなど）は、同じシーンの参照を返す
  - 失敗（存在しない ID、範囲外の値、許されない操作）は例外にせず、エラーの結果を返す。そのときシーンは変わらない
  - **干渉を理由に失敗しない**（design.md §7）。干渉は `resolveLayout` の `interferences` が赤い警告として出す。干渉する位置に置かせない判断は UI 側（S1-10 の候補、S1-17・S1-19 のハンドル）が行う
  - 成功したシーンは必ず S1-03 の `validateScene` を通る
- コマンドの一覧と規則
  - `addRootShaft`: 起点のシャフトを、歯車 1 枚（`offset 0`）付きで足す
  - `growGear`: 歯車を生やす。S1-10 の候補と同じ 2 種類
    - `perimeter`: 親の歯車と同じ大きさの歯車（`offset 0`）と、それを子に持つ `mesh` のシャフト（向きは持たない。親から導く）を作る
    - `coaxial`: 既存のシャフトに歯車を足す。`offset` が `AXIAL_SNAP` の倍数でなければ `invalidValue`
  - `deleteParts`: 部品（歯車・シャフト・モーター）を消す。複数の ID を 1 回で（1 回の Undo で戻る）
    - 歯車を消す: その歯車を `parentGearId` に持つ `mesh` のシャフトは、消す直前のワールド座標の原点と向き（`resolveLayout` の `shafts[id].origin`・`axis`）で `detached` になる（その先はそのまま。要件 §6「その先はその場に残る」）。消す歯車が自分のシャフトの `childGearId` なら、そのシャフトも同じく `detached` になる。歯車が 1 枚も残らなくなったシャフトは、そのモーターと一緒に消す
    - シャフトを消す: 載っている歯車とモーターも消す。歯車の子は上と同じく `detached` になる
    - モーターを消す: そのモーターだけ
    - 同じコマンドの中で先に消えた部品の ID は無視する。シーンに無い ID が 1 つでもあれば `notFound` で失敗
  - `setGearTeeth`: 歯数を変える（その大きさの範囲。外れたら `invalidValue`）。その先の位置は `resolveLayout` で自動でついてくる。干渉ができても失敗にしない（赤い警告。要件 §6「編集の連鎖で重なった場合は赤く警告する」）
  - `setMeshAngle`: `mesh` のシャフトの角度を変える。`[0, 2π)` に正規化して持つ。`mesh` 以外のシャフトなら `notAllowed`。干渉は失敗にしない
  - `setGearOffset`: シャフト上の位置（歯幅の負側の面の位置）を変える。`mesh` のシャフトの `childGearId` の歯車は動かせない（`notAllowed`。親とかみ合う面から外れるため）。`AXIAL_SNAP` の倍数でなければ `invalidValue`（吸着は UI の S1-19 が行い、吸着した値を渡す）。干渉は失敗にしない
  - `addMotor`: シャフトにモーターを付ける。`rpm` は `MOTOR_SIZES[size].defaultRpm`、`direction 1`、`on: true`。既にモーターがあれば `notAllowed`（1 本に高々 1 個）
  - `removeMotor`: `deleteParts` のモーターと同じ（コンテキストメニュー用の別名）
  - `updateMotor`: `size`・`rpm`・`direction`・`on` の一部を変える。`rpm` は `MOTOR_RPM_RANGE` に入らなければ `invalidValue`。`size` を変えても `rpm` は変えない
  - `moveShaft`: `root`・`detached` のシャフトの原点を変える（それ以外は `notAllowed`）。その先はついてくる。干渉は失敗にしない
  - `setShaftAxis`: `root`・`detached` のシャフトの `placement.axis` を変える。その先の `mesh` のシャフトは向きを持たないので書き換えない（`resolveLayout` で親から導かれ、ついてくる）。それ以外は `notAllowed`。干渉は失敗にしない
  - `reattachShaft`: 浮いた（`detached`）シャフトを、別の歯車の外周に付け直す（要件 §6「浮いたシャフトを…別の歯車の外周候補の上で離すと、その先ごとつなぎ直せる」。UI は S1-19）
    - `placement` を `{ kind: 'mesh', parentGearId, childGearId, angle }` にする。`childGearId` はこのシャフトに載った歯車で、親とかみ合う歯車。`angle` は `[0, 2π)` に正規化する
    - 子の `offset` が 0 になるように、このシャフトの全ての歯車の `offset` から子の `offset` を引く（シャフトの上の並びは保つ）。その先のシャフトは `resolveLayout` でついてくる
    - 失敗: シャフトが `detached` でない、`childGearId` がこのシャフトに無い、子と親の大きさが違う、親がこのシャフトかその先（`descendantShafts`）に載っている（循環）→ `notAllowed`。ID が無い → `notFound`
    - 干渉は失敗にしない
  - `replaceScene`: シーンを丸ごと置き換える（作品を開く、インポート。S1-27・S1-28 が使う。Undo で前のシーンに戻れる。design.md §9）。`validateScene` を通らなければ `invalidValue`
- Undo/Redo の履歴（純粋関数）
  - `AppState` の `scene` と `history` は別に持つ（design.md §7）。履歴は過去と未来のシーンの列
  - 成功し、シーンの参照が変わったコマンドだけを積む。積むと未来は消える
  - 上限 `HISTORY_LIMIT = 100`。超えたら古いものから捨てる
  - まとめる仕組み: 実行時に `coalesceKey` を渡すと、直前に積んだときと同じキーなら新しく積まない（連続した入力を 1 回の Undo にする。例: プロパティの数値をドラッグで変える。S1-20）。Undo・Redo・キーなしの実行で、キーは途切れる
- app への組み込み: このタスクで `AppState` に `history` を足し、ストアの `dispatch` でコマンドを実行できるようにし、`window.__gearSim` に `dispatch(command)`・`undo()`・`redo()` を足す（design.md §10）。ID はランダムの生成関数を使う。`__gearSim.loadScene` は履歴を空にしてシーンを置き換える（テストの準備用。Undo の対象にしない）

## 範囲外
- コマンドを発行する UI（起点を置く S1-17、生やす S1-18、ハンドル S1-19、プロパティ S1-20、Delete キーと Ctrl+Z の S1-16、コンテキストメニュー S1-29）
- 生やす候補の列挙（S1-10。このタスクは候補を直接は import しない。S1-18 が `GrowCandidate` をこのコマンドの引数に変換する）
- 新しく置く歯車の歯数の初期値（`DEFAULT_TEETH`。S1-17）、ハンドルの吸着（S1-17・S1-19）
- 選択の更新（S1-16。消した部品を選択から外すのは選択の側で行う）
- 自動保存（S1-27）

## 作るもの
- `src/core/constants.ts` に `HISTORY_LIMIT` を design.md §3 の表の値（100）で足す
- `src/core/edit/commands.ts`
  ```ts
  export type Command =
    | { type: 'addRootShaft'; axis: Axis; origin: Vec3; gear: { size: SizeKey; teeth: number } }
    | { type: 'growGear'; mode: 'perimeter'; parentGearId: GearId; angle: number; teeth: number }
    | { type: 'growGear'; mode: 'coaxial'; shaftId: ShaftId; offset: number; size: SizeKey; teeth: number }
    | { type: 'deleteParts'; ids: string[] }
    | { type: 'setGearTeeth'; gearId: GearId; teeth: number }
    | { type: 'setMeshAngle'; shaftId: ShaftId; angle: number }
    | { type: 'setGearOffset'; gearId: GearId; offset: number }
    | { type: 'addMotor'; shaftId: ShaftId; size: SizeKey }
    | { type: 'removeMotor'; motorId: MotorId }
    | { type: 'updateMotor'; motorId: MotorId; patch: Partial<Pick<Motor, 'size' | 'rpm' | 'direction' | 'on'>> }
    | { type: 'moveShaft'; shaftId: ShaftId; origin: Vec3 }
    | { type: 'setShaftAxis'; shaftId: ShaftId; axis: Axis }
    | { type: 'reattachShaft'; shaftId: ShaftId; childGearId: GearId; parentGearId: GearId; angle: number }
    | { type: 'replaceScene'; scene: Scene };

  export type CommandErrorCode = 'notFound' | 'invalidValue' | 'notAllowed'; // 干渉では失敗しない
  export interface CommandContext { ids: IdGenerator }
  export type CommandResult =
    | { ok: true; scene: Scene; created: string[] } // created: 新しく作った部品の ID（作った順）
    | { ok: false; error: { code: CommandErrorCode; message: string } };

  export function applyCommand(scene: Scene, command: Command, ctx: CommandContext): CommandResult;
  ```
- `src/core/edit/history.ts`
  ```ts
  export interface History {
    readonly past: readonly Scene[];   // 古い順
    readonly future: readonly Scene[]; // 次に Redo するものが先頭
    readonly coalesceKey: string | null;
  }
  export function emptyHistory(): History;

  export interface EditState { scene: Scene; history: History }
  export function execute(
    state: EditState, command: Command, ctx: CommandContext, options?: { coalesceKey?: string },
  ): { ok: true; state: EditState; created: string[] } | { ok: false; error: { code: CommandErrorCode; message: string } };
  export function undo(state: EditState): EditState | null; // 戻せなければ null
  export function redo(state: EditState): EditState | null;
  export function canUndo(history: History): boolean;
  export function canRedo(history: History): boolean;
  ```

## 受け入れ条件
- [x] 要件 §6 の編集（起点、生やす、削除して浮かせる、浮いたシャフトの付け直し、歯数・角度・位置の変更、モーター、シャフトの移動と向き）がすべてコマンドで行える
- [x] 干渉ができる編集も成功し、干渉は `resolveLayout` の `interferences` に出る
- [x] どのコマンドの後も `validateScene` が ok
- [x] Undo で、コマンドの前のシーンと同じ参照に戻る

## テストケース
ID は S1-03 の `createSequentialIdGenerator()`。下の「基本のシーン」は空のシーンから次の順で作る。
1. `addRootShaft { axis 'y', origin [0, 20, 0], gear { size 'S', teeth 12 } }` → `created = ['shaft_1', 'gear_1']`
2. `growGear perimeter { parentGearId 'gear_1', angle π/2, teeth 24 }` → `created = ['shaft_2', 'gear_2']`
3. `growGear coaxial { shaftId 'shaft_2', offset 4, size 'S', teeth 24 }` → `created = ['gear_3']`
4. `growGear perimeter { parentGearId 'gear_3', angle 0, teeth 12 }` → `created = ['shaft_3', 'gear_4']`
5. `addMotor { shaftId 'shaft_1', size 'S' }` → `created = ['motor_1']`

位置は `resolveLayout` で確かめる（歯幅は 4、`offset 0` の歯車の中心はシャフトの原点から +2。基本のシーンで `gear_1` の中心 `[0, 22, 0]`、`shaft_2` の原点 `[18, 20, 0]`、`gear_2` の中心 `[18, 22, 0]`、`gear_3` の中心 `[18, 26, 0]`、`shaft_3` の原点 `[18, 24, 18]`、`gear_4` の中心 `[18, 26, 18]`。基本のシーンに干渉は無い）。
### Vitest
- [x] 基本のシーン: `shaft_2` の `placement` は `{ kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_2', angle: π/2 }`（`axis` を持たない）、`resolveLayout` の `shafts.shaft_2.axis === 'y'`。`gear_3.offset === 4`。`motor_1` は `{ size 'S', rpm 60, direction 1, on true }`。`validateScene` が ok
- [x] 干渉しても成功する: 基本のシーンに `growGear perimeter { parentGearId 'gear_1', angle π/2, teeth 12 }`（中心 `[12, 22, 0]` で `gear_2` と重なる）→ 成功、`created = ['shaft_4', 'gear_5']`、`interferences` に `['gear_2', 'gear_5']` がある
- [x] 干渉しても成功する: `addRootShaft { axis 'y', origin [5, 20, 0], gear { 'S', 12 } }`（`gear_1` と重なる）→ 成功、`interferences` に `gear_1` と新しい歯車の組がある
- [x] 範囲外: `growGear perimeter` の `teeth 81` → `invalidValue`。存在しない `parentGearId` → `notFound`。`growGear coaxial` の `offset 2` → `invalidValue`
- [x] 削除（途中の子の歯車）: `deleteParts ['gear_2']` → `shaft_2` が `{ kind: 'detached', origin ≈ [18, 20, 0], axis: 'y' }`、`gear_3` は残る（`offset 4` のまま）、`shaft_3` は `mesh` のまま、`gear_4` の中心は `[18, 26, 18]` のまま
- [x] 削除（親の歯車）: `deleteParts ['gear_1']` → `shaft_1` と `motor_1` も消える（歯車が残らないため）、`shaft_2` が `detached`（原点 `[18, 20, 0]`、`axis 'y'`）、`gear_2` の中心は `[18, 22, 0]` のまま
- [x] 削除（シャフト）: `deleteParts ['shaft_2']` → `gear_2`・`gear_3` も消え、`shaft_3` が `detached`（原点 `[18, 24, 18]`、`axis 'y'`）
- [x] 削除（複数・重複）: `deleteParts ['shaft_2', 'gear_3']` → 成功（`gear_3` は先に消えているので無視）。`deleteParts ['gear_99']` → `notFound`、シーンは変わらない
- [x] 削除（モーター）: `deleteParts ['motor_1']` と `removeMotor { motorId 'motor_1' }` が同じ結果
- [x] 歯数: `setGearTeeth { gearId 'gear_1', teeth 20 }` → `gear_2` の中心 `[22, 22, 0]`、`gear_4` の中心 `[22, 26, 18]`。`teeth 81` → `invalidValue`。`teeth 12`（同じ値）→ 同じシーンの参照
- [x] 歯数の変更で干渉しても成功する: 基本のシーンに `addRootShaft { axis 'y', origin [40, 20, 0], gear { 'S', 12 } }`（この時点では干渉なし）→ `setGearTeeth { gearId 'gear_1', teeth 30 }` → 成功し、`gear_2` が `[27, 22, 0]` に動いて新しい起点の歯車（中心 `[40, 22, 0]`）と重なり、`resolveLayout` の `interferences` に `gear_2` と新しい歯車の組がある
- [x] 角度: `setMeshAngle { shaftId 'shaft_2', angle 0 }` → `gear_2` の中心 `[0, 22, 18]`、`gear_4` の中心 `[0, 26, 36]`。`angle −π/2` → 持つ値は `3π/2`。`shaftId 'shaft_1'`（root）→ `notAllowed`
- [x] シャフト上の位置: `setGearOffset { gearId 'gear_3', offset 8 }` → `gear_3` の中心 `[18, 30, 0]`、`gear_4` の中心 `[18, 30, 18]`。`offset 6` → `invalidValue`。`gearId 'gear_2'`（`shaft_2` の子）→ `notAllowed`
- [x] モーター: `addMotor { shaftId 'shaft_1' }` をもう一度 → `notAllowed`。`addMotor { shaftId 'shaft_2', size 'L' }` → `rpm 15`
- [x] モーターの設定: `updateMotor { motorId 'motor_1', patch { rpm 120, direction -1 } }` → 反映。`rpm 0` → `invalidValue`。`patch { size 'M' }` → `rpm` は 60 のまま。`patch { on: false }` → 反映
- [x] シャフトの移動: `moveShaft { shaftId 'shaft_1', origin [100, 20, 0] }` → `gear_2` の中心 `[118, 22, 0]`。`shaftId 'shaft_2'` → `notAllowed`。`detached` にした `shaft_2` は動かせる
- [x] 向き: `setShaftAxis { shaftId 'shaft_1', axis 'x' }` → `shaft_1.placement.axis === 'x'`。`scene.shafts.shaft_2`・`shaft_3` は前と同じ参照のまま、`resolveLayout` の `shafts` の 3 本がすべて `axis 'x'`。`gear_1` の中心 `[2, 20, 0]`、`gear_2` の中心 `[2, 20, 18]`（軸 `x` の `angle π/2` は `+Z`）。`shaftId 'shaft_2'` → `notAllowed`
- [x] 付け直し: `deleteParts ['gear_2']` の後、`reattachShaft { shaftId 'shaft_2', childGearId 'gear_3', parentGearId 'gear_1', angle π/2 }` → `shaft_2` が `{ kind: 'mesh', parentGearId: 'gear_1', childGearId: 'gear_3', angle: π/2 }`、`gear_3.offset === 0`（4 を引いた）、`gear_3` の中心 `[18, 22, 0]`、その先の `gear_4` の中心 `[18, 22, 18]`（その先ごとついてくる）。`validateScene` が ok
- [x] 付け直しの失敗: 同じ状態で、`parentGearId 'gear_4'`（`shaft_2` の先の `shaft_3` に載る。循環）→ `notAllowed`。`shaftId 'shaft_3'`（`mesh`）→ `notAllowed`。`childGearId 'gear_4'`（`shaft_2` に無い）→ `notAllowed`。`addRootShaft { axis 'y', origin [0, 20, 100], gear { 'M', 20 } }` で足した M の歯車を親にする → `notAllowed`（大きさが違う）
- [x] 参照の使い回し: `setGearTeeth { gearId 'gear_1', … }` の後、`scene.gears.gear_2`・`scene.shafts`・`scene.motors` は前と同じ参照、`scene.gears.gear_1` は新しい参照
- [x] `replaceScene` に検証を通らないシーン（歯数 11）→ `invalidValue`
- [x] 不変: 入力のシーンを `Object.freeze`（深く）しても、全てのコマンドが例外にならない
- [x] ランダムな操作列: 種を固定した乱数で、上のコマンド（`reattachShaft` を含む）を 500 回ランダムに（存在する ID を選んで）適用 → 成功したものの後は毎回 `validateScene` が ok
- [x] 履歴: 基本のシーンの 5 コマンドを `execute` → `undo` を 5 回で `emptyScene()` と等しいシーン、6 回目は `null`。`redo` 5 回で基本のシーンと同じ参照
- [x] 履歴の参照: `deleteParts ['gear_2']` → `undo` → 削除前のシーンと同じ参照（`toBe`）
- [x] 失敗したコマンド・何も変えないコマンドは履歴に積まない（`past` の長さが変わらない）
- [x] Undo の後に新しいコマンド → `future` が空になる
- [x] 上限: 101 回 `moveShaft`（毎回違う原点）→ `past.length === 100`
- [x] まとめる: `updateMotor { rpm 70 }`、`{ rpm 80 }`、`{ rpm 90 }` を同じ `coalesceKey: 'rpm-drag-1'` で → `undo` 1 回で `rpm 60` に戻る。間に `undo` か、キーなしのコマンドが入ると途切れる
### Playwright
- [x] `loadScene(空のシーン)` → `__gearSim.dispatch` で基本のシーンの 5 コマンドを順に → `getScene().gears` が 4 枚、0.5 秒後に `getMotion().angles.shaft_1` が増えている（アプリの ID はランダムなので、`shaft_1` は起点のシャフトの実際の ID に読み替える） → `undo()` を 5 回 → `getScene()` が空

## 人が手で確かめる項目
- なし

## 完了の条件
- [x] 上のテストケースがすべて実装済みで、`pnpm verify` が通る
- [x] design.md と後続のタスク資料に、必要な変更を反映した（`Command` の一覧・削除と付け直しの規則・`coalesceKey` を design.md §7 に書く。`__gearSim` に足した API が §10 と合っているか確かめる。S1-16・S1-17・S1-20・S1-27 の資料のコマンド名がこれと合っているか確かめる）
- [ ] `status: done` にしてコミットした
