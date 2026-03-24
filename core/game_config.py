# ゲーム全体の設定値（外部化パラメータ）
CONFIG = {
    # お手本線のスクロール速度（px/sec 相当）
    "scroll_speed": 60, 
    
    # セグメント数 (不変要件: 12)
    "num_segments": 12,
    
    # 線の太さ
    "line_width": 40,
    
    # スコア計算における許容範囲距離 (px)
    "tolerance": 10,
    
    # 内部スコア上限（これを越える点数はこの値に切り詰められます）
    "max_internal_score": 105,
    
    # 内部スコア換算時、表示スコアが100点に丸められる基準
    "max_display_score": 100,
    
    # WASDの移動スピード（px/sec）
    "player_speed": 125,
}
