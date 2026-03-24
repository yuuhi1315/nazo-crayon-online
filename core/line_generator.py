import random

def generate_model_line():
    """
    12個のセグメントから成るお手本線を生成します。
    画面からはみ出さないよう、Y制約（+1, 0, -1）を設定し、垂直方向の極端な逸脱を防ぎます。
    """
    segments = ["straight"]
    current_y = 0  # 0: center, -1: up, 1: down
    
    for _ in range(10):
        choices = ["straight"]
        
        # Upper bounds logic (-1 is the highest we can go logically)
        if current_y > -1:
            choices.extend(["vertical_step_up", "large_curve_up"])
            
        # Any state logic (safe to small curve or loop towards bounds if handled frontend, but let's be strict)
        if current_y >= 0: # Can go up safely
            choices.extend(["small_curve_up", "loop_up"])
        else: # at highest point, don't curve up
            choices.extend(["small_curve_down"])

        # Lower bounds logic
        if current_y < 1:
            choices.extend(["vertical_step_down", "large_curve_down"])
            
        if current_y <= 0:
            choices.extend(["small_curve_down", "loop_down"])
        else:
            choices.extend(["small_curve_up"])
            
        choice = random.choice(choices)
        segments.append(choice)
        
        if choice == "vertical_step_up":
            current_y -= 1
        elif choice == "vertical_step_down":
            current_y += 1
            
    segments.append("straight")
    return segments
