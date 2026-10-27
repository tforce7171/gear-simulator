# カメラ／ナビゲーション操作 調査レポート

対象: Three.js製 3Dブラウザ歯車サンドボックス(PCブラウザ主、タッチは後で対応)
調査日: 2026-10-27

> 注記: 各ツールの操作は、可能な限り公式ドキュメントで確認した(出典URLは各節に記載)。「(未確認)」としたものは公式ページで確認できなかった項目で、一般に知られている既定値または二次情報をもとにしている。どのツールもプリファレンスで割り当てを変えられるので、ここに書いたのは**既定値**。

---

## 1. ツール別の既定操作

### 1.1 Blender
- 回転: **中ボタン(MMB)ドラッグ**
- パン: **Shift+MMB**
- ズーム: ホイール、または Ctrl+MMB ドラッグ。カーソル位置へのズーム(Zoom to Mouse Position)は**既定でOFF**で、画面中心に向かってズームする
- 選択のフォーカス: **テンキー `.`(View Selected)**。全体表示は **Home**(View All)
- 標準ビュー: テンキー 1=前 / 3=右 / 7=上、Ctrl+同じキーで反対側、5=透視/平行投影の切替、0=カメラ視点、2/4/6/8=15°ずつ回転。`` ` ``(バッククォート)でビューのパイメニュー。画面右上のナビゲーションギズモでも操作できる
- 選択と回転の競合: LMB=選択(2.8以降)、回転はMMBに分けている。3ボタンのないマウス向けに「3ボタンマウスをエミュレート」(Alt+LMB=回転)と「テンキーをエミュレート」がプリファレンスにある
- トラックパッド: **2本指スクロール=回転、Shift+2本指=パン、ピンチ=ズーム**、Ctrl+2本指=ズーム
- 出典: https://docs.blender.org/manual/en/latest/editors/3dview/navigate/navigation.html (本文は長大なため要点は既知の既定値で補った)

### 1.2 Maya
- 回転(Tumble): **Alt+LMB**(Mac は Option+LMB)
- パン(Track): **Alt+MMB**
- ズーム(Dolly): **Alt+RMB**、Alt+LMB+MMB、ホイール。Alt+Ctrl+ドラッグで矩形の範囲へズーム
- フォーカス: **F**=選択をアクティブパネルでフレーム、Shift+F=全パネルで、**A**=全体をフレーム
- 標準ビュー: ViewCube、またはスペースバー長押しのホットボックスで正投影ビューへ切替
- 選択と回転の競合: **修飾キー方式**。LMB単独は常に選択で、Altを押している間だけカメラを操作する
- トラックパッド: 公式の専用ジェスチャはほぼない(Option+クリック操作が前提)
- 出典: https://help.autodesk.com/cloudhelp/2023/ENU/Maya-Basics/files/GUID-941480C1-9BDA-4DB3-8EA8-113A0D6FAF1F.htm / https://www.autodesk.com/shortcuts/maya

### 1.3 3ds Max
- 回転: **Alt+MMB**(Orbit / Orbit Selected / Orbit Subobject のどのモードで回るかは設定次第)
- パン: **MMB ドラッグ**
- ズーム: ホイール(カーソル位置へズームする設定が既定)、Ctrl+Alt+MMB で滑らかにズーム
- フォーカス: **Z**=Zoom Extents Selected(選択がなければ全体)、Ctrl+Shift+Z=全ビューポートで全体表示(二次情報で、版によって違う)
- 標準ビュー: **T / B / F / L / P / U**(上/下/前/左/透視/ユーザー視点)、ViewCube
- 選択と回転の競合: LMB=選択、カメラは MMB 系
- 出典: https://help.autodesk.com/cloudhelp/2017/ENU/3DSMax/files/GUID-D65DE5FD-F859-4F66-9E14-F9A5C1016411.htm

### 1.4 Cinema 4D
- 回転: **Alt+LMB**
- パン: **Alt+MMB**
- ズーム: **Alt+RMB**、ホイール
- 1/2/3 キーを押しながら LMB ドラッグでも、パン/ズーム/回転ができる。画面右上のナビゲーションアイコンをドラッグしても操作できる
- フォーカス: **S**=選択をフレーム、H=全体をフレーム(H は未確認)
- 標準ビュー: F1=透視、F2=上、F3=右、F4=前、F5=4分割
- 選択と回転の競合: Maya と同じ Alt 修飾方式
- 出典: https://cineversity.forums.maxon.net/post/535 / https://novedge.com/blogs/design-news/cinema-4d-tip-efficient-viewport-navigation-techniques-in-cinema-4d (二次情報)

### 1.5 Fusion (Fusion 360)
- 回転: **Shift+MMB**
- パン: **MMB ドラッグ**
- ズーム: ホイール(**カーソル位置へズーム**)、Ctrl+Shift+MMB
- フォーカス: **F6**=全体表示(Fit)。選択して Fit すると、その選択にフィットする
- 標準ビュー: ViewCube(面・辺・角をクリック)、Home アイコン
- 選択と回転の競合: LMB=選択、カメラは MMB 系。プリファレンスで操作プリセット(Fusion / SolidWorks / Inventor / Tinkercad / Alias / PowerMill)を選べる
- トラックパッド: 2本指=パン、ピンチ=ズーム、Shift+2本指=回転(Mac)
- 出典: https://www.autodesk.com/products/fusion-360/blog/quick-tip-pan-zoom-orbit-preferences/

### 1.6 SketchUp
- 回転: **MMB(ホイールボタン)長押しドラッグ**(他のツールを使っている最中でも一時的に Orbit になる)。O キー=Orbit ツール
- パン: **Shift+MMB**。H キー=Pan ツール
- ズーム: ホイール(**カーソル位置を中心にズーム**と公式に明記)
- フォーカス: **Shift+Z**=Zoom Extents(全体表示)。選択へのズームは右クリックメニューの Zoom Selection
- 標準ビュー: Camera > Standard Views メニュー/ツールバー(既定ではショートカットキーなし)
- 選択と回転の競合: LMB はアクティブなツール(選択・描画)用、カメラは MMB
- 出典: https://help.sketchup.com/en/sketchup/viewing-model / https://help.sketchup.com/hu/default-keyboard-shortcuts

### 1.7 Onshape(ブラウザCAD)
- 回転: **RMB ドラッグ**(Mac では Alt+RMB でも可)
- パン: **MMB ドラッグ** または **Ctrl+RMB**
- ズーム: ホイール(カーソル位置へズーム)
- キーボード: 矢印=15°回転、Shift+矢印=90°、Ctrl+矢印=5°、Z / Shift+Z=ズーム、Ctrl+Shift+矢印=パン
- フォーカス: **F**=Zoom to fit(未確認。公式ページでは ViewCube メニューの「Zoom to fit」として確認)
- 標準ビュー: ViewCube の面/角、Shift+1〜7(前/後/左/右/上/下/等角)(Shift+数字は未確認)
- トラックパッド(Mac): **2本指クリックしてドラッグ=回転**、Ctrl+2本指クリックしてドラッグ=パン、**ピンチまたは2本指スクロール=ズーム**
- タッチ: 1本指=回転、2本指ドラッグ=パン、ピンチ=ズーム、2本指をひねる=画面内での回転
- 選択と回転の競合: **LMB=選択、RMB ドラッグ=回転、RMB クリック=コンテキストメニュー**(ドラッグかクリックかで区別する)
- 出典: https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm / https://onshape.com/en/resource-center/tech-tips/tech-tip-changing-rotate-pan-and-zoom

### 1.8 Unity エディタ(Scene ビュー)
- 回転: **Alt+LMB**(Mac は Option+LMB)
- パン: **MMB ドラッグ**、または View ツール(Q)を選んで LMB ドラッグ。2ボタン環境では Alt+Ctrl+LMB(Mac は Option+Cmd+LMB)
- ズーム: ホイール、または Alt+RMB(Mac は Option+Ctrl+LMB も可)
- フライスルー: **RMB を押しながら WASD+QE**、Shift で加速
- フォーカス: **F**=Frame Selected(もう一度押すとピボットへ寄る)、Shift+F=選択にビューを追従(ロック)
- 標準ビュー: Orientation オーバーレイ(ギズモ)の軸をクリック
- トラックパッド(Mac): **2本指ドラッグ=ズーム**、**3本指スワイプ=上下左右のビューへスナップ**
- 選択と回転の競合: LMB=選択/トランスフォームツール、回転は Alt 修飾、RMB はフライ操作
- 出典: https://docs.unity.com/en-us/engine/current/manual/unity-editor/editor-windows-views-reference/using-the-scene-view/scene-view-navigation

### 1.9 Unreal Editor
- 既定(透視ビュー): **LMB ドラッグ=前後移動+左右旋回**、**RMB ドラッグ=見回し**、**LMB+RMB または MMB=上下左右へパン**、**RMB を押しながら WASD/QE=フライ**、ホイールで速度調整または前後移動
- Maya 式も使える: **Alt+LMB=回転(Tumble)、Alt+RMB=ドリー、Alt+MMB=トラック**
- フォーカス: **F**=選択にフォーカス
- 標準ビュー: ビューポートのメニューで Top / Front / Side を選ぶ。Alt+G/H/J/K=透視/前/上/側面(未確認)
- 選択と回転の競合: **LMB はクリックなら選択、ドラッグならカメラ移動**(何もないところをドラッグするとカメラが動く)。正投影ビューでは LMB ドラッグが矩形選択になる
- 出典: https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine / https://docs.unrealengine.com/4.26/BuildingWorlds/LevelEditor/Viewports/ViewportControls

### 1.10 Tinkercad(ブラウザ)
- 回転: **RMB ドラッグ**
- パン: **MMB ドラッグ**、または Shift+RMB(Shift+RMB は二次情報)
- ズーム: ホイール、+/-キー
- フォーカス: **F**=選択にフィット(未選択なら全体)。画面左のビューキューブ横に Home/Fit ボタンがある
- 標準ビュー: ビューキューブをクリック
- 選択と回転の競合: **LMB=選択/形状のドラッグ移動、空白で LMB ドラッグ=矩形選択**、回転は RMB
- 出典: https://www.autodesk.com/products/fusion-360/blog/quick-tip-pan-zoom-orbit-preferences/(Fusion の Tinkercad プリセット表) / https://boisestate.edu/library-makerlab/tinkercad-tutorials-test/navigating-the-workplane

### 1.11 Spline(ブラウザ製デザインツール)
- 回転: **Option/Alt+ドラッグ**
- パン: **Space+ドラッグ**(Figma 系の慣習)、トラックパッドでは**2本指ドラッグ**
- ズーム: ホイール、Cmd/Ctrl+ホイール、**ピンチ**
- 標準ビュー: 画面下中央のビューヘルパーで軸を選ぶ・リセットする・アイソメ表示にする。M=透視/平行投影の切替
- 選択と回転の競合: LMB は常に選択/移動。回転は Alt 修飾
- 出典: https://docs.spline.design/cameras/working-with-cameras

### 1.12 three.js editor / OrbitControls の既定値
- `mouseButtons = { LEFT: ROTATE, MIDDLE: DOLLY, RIGHT: PAN }`
- `touches = { ONE: ROTATE, TWO: DOLLY_PAN }`
- ホイール=ドリー。`zoomToCursor = false`(r153 以降にあるオプション)。`screenSpacePanning = true`、`enableDamping = false`
- LEFT=ROTATE のとき、**Ctrl/Meta/Shift+LMB でパンに切り替わる**
- キー: `listenToKeyEvents()` を呼ぶと矢印キーでパンできる
- フォーカス/フレーム機能は**ない**(target を自前で設定する)
- three.js editor の EditorControls: LMB=回転、MMB=ズーム、RMB=パン。**ダブルクリックでオブジェクトにフォーカス**。クリック(ドラッグなし)は選択として扱う
- Mac トラックパッド: ピンチは `ctrlKey=true` の wheel イベントとして届く。OrbitControls はこれをドリーとして扱う(新しい版ではピンチの delta を補正している)。2本指スクロールもドリーになる
- 出典: https://threejs.org/docs/#examples/en/controls/OrbitControls / https://github.com/mrdoob/three.js/blob/dev/examples/jsm/controls/OrbitControls.js

### 1.13 Sketchfab ビューア
- 回転: **LMB ドラッグ**(Orbit モード)
- パン: **RMB ドラッグ**、または Shift+LMB(Ctrl+LMB とする情報もある)
- ズーム: ホイール、ピンチ
- フォーカス: **モデル上でダブルクリック=そこを回転中心にして寄る**、背景をダブルクリック=中心に戻す
- タッチ: 1本指=回転、2本指=パン/ピンチズーム、ダブルタップ=フォーカス
- First Person モード(WASD)もある
- 出典: https://help.sketchfab.com/en/articles/16152696

---

## 2. 比較表

| ツール | 回転 | パン | ズーム | カーソル位置へズーム | 選択をフレーム | 全体表示 | 標準ビュー | LMB の役割 | トラックパッド |
|---|---|---|---|---|---|---|---|---|---|
| Blender | MMB | Shift+MMB | ホイール / Ctrl+MMB | 既定OFF | テンキー `.` | Home | テンキー1/3/7(+Ctrl), 5 | 選択 | 2本指=回転, Shift=パン, ピンチ=ズーム |
| Maya | Alt+LMB | Alt+MMB | Alt+RMB / ホイール | ほぼ中心 | F | A | ViewCube / ホットボックス | 選択(Alt時のみカメラ) | ― |
| 3ds Max | Alt+MMB | MMB | ホイール | ON | Z | Z(未選択時) | T/B/F/L/P | 選択 | ― |
| Cinema 4D | Alt+LMB | Alt+MMB | Alt+RMB / ホイール | 設定次第 | S | H | F1〜F5 | 選択 | ― |
| Fusion | Shift+MMB | MMB | ホイール | ON | F6(選択あり) | F6 | ViewCube | 選択 | 2本指=パン, ピンチ=ズーム, Shift+2本指=回転 |
| SketchUp | MMB | Shift+MMB | ホイール | ON(明記) | 右クリックメニュー | Shift+Z | メニュー | ツール | ― |
| Onshape | RMB | MMB / Ctrl+RMB | ホイール | ON | F(未確認) | ViewCube | ViewCube / Shift+数字 | 選択 | 2本指クリックしてドラッグ=回転, 2本指スクロール/ピンチ=ズーム |
| Unity | Alt+LMB | MMB / Q+LMB | ホイール / Alt+RMB | ― | F | ― | ギズモ | 選択 | 2本指=ズーム, 3本指=ビューへスナップ |
| Unreal | LMB/RMB ドラッグ(見回し), Alt+LMB | MMB / LMB+RMB | ホイール / Alt+RMB | ― | F | ― | メニュー | クリック=選択 / ドラッグ=カメラ | ― |
| Tinkercad | RMB | MMB (Shift+RMB) | ホイール | ON | F | F(未選択時) | ビューキューブ | 選択/移動/矩形選択 | ― |
| Spline | Alt+ドラッグ | Space+ドラッグ / 2本指 | ホイール / ピンチ | ON | ― | ― | ビューヘルパー | 選択/移動 | 2本指=パン, ピンチ=ズーム |
| OrbitControls | LMB | RMB / Ctrl/Shift+LMB | ホイール / MMB | 既定OFF | なし | なし | なし | 回転(選択はアプリ側) | wheel として処理 |
| three.js editor | LMB | RMB | MMB / ホイール | ― | ダブルクリック | ― | ― | クリック=選択 / ドラッグ=回転 | ― |
| Sketchfab | LMB | RMB / Shift+LMB | ホイール / ピンチ | ― | ダブルクリック | 背景ダブルクリック | ― | 回転 | ピンチ=ズーム |

---

## 3. 「最大公約数」と言える操作

### 3.1 ほぼ全ツールで共通している点
1. **ホイール=ズーム**: 例外なし。CAD/ブラウザ系(Fusion, SketchUp, Onshape, Tinkercad, 3ds Max, Spline)は**カーソル位置へのズーム**が既定。
2. **MMB ドラッグはカメラ操作**: パンにするツール(Fusion, Onshape, Tinkercad, 3ds Max, Unity)が最多で、回転にするツールは Blender と SketchUp。どちらにしても「MMB=カメラ」は共通。
3. **F=選択をフレーム**: Maya, Unity, Unreal, Tinkercad, Onshape が F。Blender(テンキー `.`)、3ds Max(Z)、C4D(S)は少数派。**F が事実上の標準**と言える。
4. **Alt(Option)+LMB=回転**: Maya, C4D, Unity, Unreal(Maya式), Spline で通じる。DCC やゲームエンジンの利用者には「どこでも回せる安全な操作」として覚えられている。
5. **ビューキューブ/軸ギズモ**: CAD とブラウザ系の大半が持っている。テンキーを使うのは実質 Blender だけ(ノートPCにはテンキーがないことも多い)。

### 3.2 LMB を「選択・配置・歯車を手で回す」に使う場合
LMB をオブジェクト操作に使うツールは、次の3つの方式のどれかで競合を避けている。

| 方式 | 代表ツール | 長所 | 短所 |
|---|---|---|---|
| A. 回転を RMB に分ける | Onshape, Tinkercad | LMB と完全に分離でき、CAD/ブラウザ系の利用者に馴染みがある | RMB のコンテキストメニューとぶつかる(ドラッグ量のしきい値で区別する)。トラックパッドだと RMB ドラッグがやりにくい |
| B. 回転を修飾キー+LMB にする | Maya, Unity, C4D, Spline | 1ボタン環境やトラックパッドでも使える | 初心者には見つけにくい |
| C. 当たり判定で決める(物体の上なら物体操作、空白ならカメラ) | Unreal(ドラッグ=カメラ), three.js editor, Sketchfab, 多くの Web ビューア | 直感的で、操作説明がなくても使える。タッチと相性が良い | 空白での矩形選択が使えない。物体が画面を埋め尽くすと回せなくなる |

**結論(最も期待されやすい組み合わせ)**: 方式 **C を基本にして、A と B を併用する**のが、どの経歴のユーザーにも違和感が少ない。
- Web 3D ビューア/OrbitControls 慣れ → 空白で LMB ドラッグして回す(C)
- Onshape / Tinkercad / Fusion 慣れ → RMB で回す、MMB でパン(A)
- Maya / Unity / Blender(Alt エミュレーション)慣れ → Alt+LMB で回す(B)
- 全員 → ホイールでカーソル位置へズーム、F でフレーム

---

## 4. 推奨する操作体系

### 4.1 マウス(PC)
| 操作 | 割り当て | 由来・理由 |
|---|---|---|
| 歯車の選択・配置 | LMB クリック | 全ツール共通 |
| 歯車を手で回す・移動する | **歯車の上で LMB を押してドラッグ** | アプリの中心となる操作なので最優先 |
| カメラ回転 | **空白で LMB ドラッグ** / **RMB ドラッグ** / **Alt(Option)+LMB ドラッグ(歯車の上でも回る)** | C+A+B。RMB はドラッグ量が 3〜5px を超えたら回転、それ未満で離したらコンテキストメニュー(Onshape 式) |
| パン | **MMB ドラッグ** / **Shift+RMB ドラッグ** / **Shift+LMB を空白でドラッグ** / **Space+LMB ドラッグ** | MMB=Fusion/Onshape/Tinkercad/3ds Max。Shift+ドラッグは OrbitControls・Sketchfab と同じ。Space は Spline/Figma 系 |
| ズーム | **ホイール=カーソル位置へドリー**。Ctrl+Shift+MMB は割り当てない | CAD/ブラウザ系の多数派 |
| 選択をフレーム | **F**(未選択なら全体) | Maya/Unity/Unreal/Tinkercad |
| 全体表示 | **Home** または Shift+F(どちらも有効) | Blender Home / SketchUp の Zoom Extents に相当 |
| 回転中心の変更 | **歯車をダブルクリック=その点を回転中心にして寄る** | Sketchfab / three.js editor |
| 標準ビュー | **画面右上の軸ギズモ/ビューキューブ(クリック)** + **テンキー 1/3/7(Ctrl で反対側)、5=透視/平行投影の切替、0 または . はリセット**(Blender互換)。テンキーのない環境向けに **Alt+1/2/3** などの代替も用意する | 主にギズモで操作し、Blender 利用者のためにテンキーも残す |
| 回転のスナップ | 矢印キー=15°ずつ回転(Onshape と同じ) | キーボードだけでも操作できる |

補足:
- 空白で LMB ドラッグすると回転するので、**矩形選択は Ctrl/Cmd+空白ドラッグ**など修飾キー付きに逃がす(必要になった時点で追加)。
- 「歯車を回している最中に勝手にカメラが動く」のを防ぐため、pointerdown 時点でのレイキャスト結果でドラッグの種類を確定し、そのドラッグの間は変えない。
- 設定画面に**操作プリセット**(既定 / Blender / Fusion・Onshape / Maya)を用意しておくと、上級者の不満を吸収できる(Fusion・Onshape と同じ考え方)。

### 4.2 Mac トラックパッド
macOS のブラウザでは、ピンチは `wheel` イベント(`ctrlKey=true`)、2本指スクロールは `wheel` イベント(`deltaX`/`deltaY`、ピクセル単位)として届く。Safari には `gesturestart/gesturechange` もある。

| 操作 | 割り当て | 理由 |
|---|---|---|
| ズーム | **ピンチ(ctrlKey 付き wheel)=カーソル位置へズーム** | Onshape / Fusion / Spline / Sketchfab 共通 |
| 回転 | **1本指で空白をクリックしてドラッグ**、または Option+ドラッグ | マウス時の C/B 方式と同じで、別の操作を覚えなくてよい |
| パン | **2本指スクロール=パン**(Fusion / Spline / Figma 系)、Shift+クリックしてドラッグでも可 | ズームはピンチがあるので、2本指は空いているパンに割り当てる |
| (設定) | 2本指スクロールを「パン/回転(Blender式)/ズーム(Onshape式)」から選べるようにする | ツールによって割り当てが分かれているので、選べるようにする |

**マウスホイールとトラックパッドの判別**: 確実な方法はない。`deltaMode===0` で小数や小さな delta が連続する、`deltaX≠0` がある、といった状態をヒューリスティックで検出し、「トラックパッドモード」へ自動で切り替える。誤判定に備えて、設定で「入力デバイス: 自動/マウス/トラックパッド」を固定できるようにする。マウスモードでは、ホイールは常にズーム。

### 4.3 タッチ(後で対応)
- 1本指: 歯車の上なら歯車を操作、空白なら回転
- 2本指: ピンチ=ズーム、ドラッグ=パン(OrbitControls / camera-controls / Onshape / Sketchfab と同じ)
- ダブルタップ: フォーカス(Sketchfab)
- 長押し: コンテキストメニュー

---

## 5. ライブラリが標準で対応している範囲

### three.js OrbitControls
- **対応している**: ボタンごとの割り当て(`mouseButtons`、`touches`)、Ctrl/Shift/Meta+LMB でのパン切替、`zoomToCursor`、慣性(damping)、`minDistance` / `maxPolarAngle` などの制限、矢印キーでのパン、`enabled` での一時無効化、`cursor` の扱い(新しい版)
- **対応していない**: フレーム/フォーカス(Box3 に合わせる)機能、カメラ遷移のアニメーション、回転中心のスムーズな移動、トラックパッドの2本指スクロールをパンにする処理(wheel は常にドリー)、ドラッグかクリックかの区別、物体の当たり判定に基づくボタン切替
- 当たり判定による切替は、pointerdown で歯車に当たったら `controls.enabled = false` にする方式が定番。ただしイベントの登録順に注意(OrbitControls より先にアプリ側のハンドラを登録し、当たったら `stopPropagation` するなど)。

### yomotsu/camera-controls(推奨)
- **対応している**: `mouseButtons.left/middle/right/wheel` に `ROTATE / TRUCK / SCREEN_PAN / OFFSET / DOLLY / ZOOM / NONE` を割り当てられる。`touches.one/two/three` も同様。`dollyToCursor`(カーソル位置へドリー)。**`fitToBox(mesh, true, {padding})` / `fitToSphere`**(F キーのフレームがそのまま作れる)。`setLookAt` / `setOrbitPoint`(ダブルクリックで回転中心を変える処理に使える)。`rotateTo` / `rotatePolarTo` / `rotateAzimuthTo`(標準ビューへアニメーション付きで遷移)。`smoothTime` / `draggingSmoothTime` による滑らかな動き。`truck()` / `dolly()` / `rotate()` の API。`boundary`、距離や角度の制限。`setViewport`
- **対応していない**: キーボード操作(自前で実装する)、トラックパッドの判別、ピンチ(ctrlKey 付き wheel)と2本指スクロールの区別(wheel は1種類の扱い)、当たり判定に基づく切替
- 当たり判定による切替は、pointerdown で `mouseButtons.left = ACTION.NONE`(歯車に当たったとき)と `ROTATE`(空白のとき)を毎回書き換えるだけで実現できる。
- トラックパッド対応では、`mouseButtons.wheel = ACTION.NONE` にして wheel イベントを自前で受け、`ctrlKey` 付きなら `dolly`(カーソル位置へ)、それ以外は `truck(deltaX, deltaY)` と振り分ける。

**採用の推奨**: フレーム、遷移アニメーション、回転中心の変更、ボタン割り当ての動的な変更を全部標準で持っている **camera-controls** を使う。OrbitControls だと、これらを自前で実装する量がかなり多くなる。

---

## 6. 実装メモ(優先順位)
1. pointerdown でのレイキャスト → 歯車の操作かカメラ操作かを確定(ドラッグの途中では変えない)
2. camera-controls: left=空白なら ROTATE / 歯車上なら NONE、right=ROTATE(3〜5px のしきい値)、middle=TRUCK、wheel=DOLLY + `dollyToCursor=true`
3. Alt+LMB は常に ROTATE、Shift+LMB(空白)/ Shift+RMB は TRUCK
4. F=`fitToBox(選択 or 全体, true, {padding})`、Home=全体、ダブルクリック=`setOrbitPoint` と寄り
5. 軸ギズモ+テンキーでビューを切替(`rotateTo` でアニメーション)
6. wheel を自前処理(ピンチ=ズーム、2本指=パン、マウスモード=ズーム)と、入力デバイス設定
7. 操作プリセットとヘルプのオーバーレイ(画面隅に「左ドラッグ: 回転 / 右ドラッグ: 回転 / 中ドラッグ: パン / ホイール: ズーム / F: フォーカス」)
