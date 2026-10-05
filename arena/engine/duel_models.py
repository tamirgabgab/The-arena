"""Duel win-probability models f(p1, p2).

Every model satisfies, for all p1, p2 in [0, 1]:
    0 <= f <= 1,   f(p, p) = 1/2,   f(p1, p2) + f(p2, p1) = 1.
f is the probability that the attacker (skill p1) beats the defender (skill p2).
A global "luck" factor lam mixes any model with a fair coin: (1 - lam) f + lam / 2.
"""
import math

import numpy as np
from numba import njit

# Order defines the numeric model id used inside the jitted code.
MODELS = [
    {
        "id": "power",
        "name": "חזקה (Tullock / Bradley–Terry)",
        "latex": r"f(p_1,p_2)=\frac{p_1^{\,z}}{p_1^{\,z}+p_2^{\,z}}",
        "description": (
            "המודל הקלאסי של תחרויות: הסיכוי לנצח פרופורציונלי ל\"כוח\" של המתמודד בחזקת z. "
            "z=1 שקול למרוץ שבו כל מתמודד עונה בזמן מעריכי עם קצב p – מי שעונה ראשון מנצח. "
            "z קטן מ-1 מקרב את הכל להטלת מטבע, z גדול הופך את הקרב לכמעט דטרמיניסטי. "
            "מתמודד עם p=0 מפסיד תמיד למי שיש לו p חיובי."
        ),
        "param": {"symbol": "z", "default": 1.0, "min": 0.05, "max": 20.0, "step": 0.05},
    },
    {
        "id": "log5",
        "name": "יחס סיכויים (Log5 / Bill James)",
        "latex": r"f(p_1,p_2)=\frac{\left[p_1(1-p_2)\right]^{z}}{\left[p_1(1-p_2)\right]^{z}+\left[p_2(1-p_1)\right]^{z}}",
        "description": (
            "p מתפרש כסיכוי לנצח מתמודד ממוצע (p=0.5). עבור z=1 זו נוסחת Log5 מהבייסבול: "
            "מתמודד עם p=0.5 מנצח מתמודד אחר בדיוק בהסתברות p שלו. "
            "שקול למודל לוגיסטי על ה-logit של p, ולכן ערכים קרובים ל-0 או 1 \"קיצוניים\" מאוד. "
            "z שולט בחדות."
        ),
        "param": {"symbol": "z", "default": 1.0, "min": 0.05, "max": 10.0, "step": 0.05},
    },
    {
        "id": "logistic",
        "name": "לוגיסטי (Elo)",
        "latex": r"f(p_1,p_2)=\frac{1}{1+e^{-k\,(p_1-p_2)}}",
        "description": (
            "מבוסס על הפרש היכולות בלבד, כמו דירוג Elo בשחמט. "
            "נובע מהנחה שביצועי כל מתמודד הם יכולת + רעש מהתפלגות גאמבל. "
            "k הוא החדות: k=0 הטלת מטבע, k גדול – היכול יותר כמעט תמיד מנצח."
        ),
        "param": {"symbol": "k", "default": 5.0, "min": 0.1, "max": 50.0, "step": 0.1},
    },
    {
        "id": "probit",
        "name": "פרוביט (Thurstone)",
        "latex": r"f(p_1,p_2)=\Phi\!\left(k\,(p_1-p_2)\right),\quad \Phi(x)=\tfrac12\left[1+\operatorname{erf}\!\left(\tfrac{x}{\sqrt2}\right)\right]",
        "description": (
            "ביצועי כל מתמודד ביום הקרב הם יכולת + רעש נורמלי; המנצח הוא בעל הביצוע הגבוה. "
            "Φ היא פונקציית ההצטברות של ההתפלגות הנורמלית. "
            "דומה מאוד ללוגיסטי, אבל עם זנבות דקים יותר – הפתעות גדולות נדירות יותר."
        ),
        "param": {"symbol": "k", "default": 3.0, "min": 0.1, "max": 30.0, "step": 0.1},
    },
    {
        "id": "arctan",
        "name": "ארקטנגנס (Cauchy)",
        "latex": r"f(p_1,p_2)=\frac12+\frac{1}{\pi}\arctan\!\left(k\,(p_1-p_2)\right)",
        "description": (
            "כמו פרוביט, אבל הרעש מהתפלגות קושי בעלת זנבות כבדים. "
            "התוצאה: גם פער יכולות גדול משאיר סיכוי ממשי להפתעה – מתאים לעולם עם הרבה מזל."
        ),
        "param": {"symbol": "k", "default": 5.0, "min": 0.1, "max": 100.0, "step": 0.1},
    },
    {
        "id": "linear",
        "name": "לינארי חסום",
        "latex": r"f(p_1,p_2)=\min\!\left(1,\ \max\!\left(0,\ \tfrac12+\tfrac{k}{2}\,(p_1-p_2)\right)\right)",
        "description": (
            "הסיכוי עולה בקו ישר עם הפרש היכולות. עבור k=1 כל טווח היכולות ממופה בדיוק ל-[0,1] "
            "(p=1 נגד p=0 מנצח בוודאות). k>1 גורם לרוויה מהירה יותר – "
            "פער של 1/k ומעלה מבטיח ניצחון."
        ),
        "param": {"symbol": "k", "default": 1.0, "min": 0.05, "max": 20.0, "step": 0.05},
    },
    {
        "id": "powdiff",
        "name": "הפרש בחזקה",
        "latex": r"f(p_1,p_2)=\frac12+\frac12\,\operatorname{sgn}(p_1-p_2)\,\left|p_1-p_2\right|^{z}",
        "description": (
            "משפחה גמישה סביב z=1 (לינארי). z<1: גם פער קטן ביכולת נותן יתרון משמעותי (חד ליד השוויון). "
            "z>1: פערים קטנים כמעט לא משנים, ורק פערים גדולים מכריעים."
        ),
        "param": {"symbol": "z", "default": 1.0, "min": 0.05, "max": 10.0, "step": 0.05},
    },
    {
        "id": "uniform_noise",
        "name": "רעש אחיד (משולשי)",
        "latex": (
            r"X_i=p_i+U_i,\ U_i\sim\mathcal U(-w,w),\quad s=\frac{p_1-p_2}{2w},\quad "
            r"f=\begin{cases}0 & s\le-1\\ \frac{(1+s)^2}{2} & -1<s<0\\ 1-\frac{(1-s)^2}{2} & 0\le s<1\\ 1 & s\ge 1\end{cases}"
        ),
        "description": (
            "ביצועי כל מתמודד = יכולת + רעש אחיד ברוחב w. הפרש שני רעשים אחידים מתפלג משולשית, "
            "ולכן f היא פונקציית ההצטברות של התפלגות משולשית. "
            "מאפיין ייחודי: כשפער היכולות עולה על 2w – הניצחון ודאי."
        ),
        "param": {"symbol": "w", "default": 0.25, "min": 0.01, "max": 2.0, "step": 0.01},
    },
]

MODEL_INDEX = {m["id"]: i for i, m in enumerate(MODELS)}

_LOG_CLAMP = 700.0


@njit(cache=True)
def _ratio_prob(u, v, z):
    """u^z / (u^z + v^z) computed in log space; 0/0 -> 1/2."""
    if u <= 0.0 and v <= 0.0:
        return 0.5
    if u <= 0.0:
        return 0.0
    if v <= 0.0:
        return 1.0
    r = z * (math.log(v) - math.log(u))
    if r > _LOG_CLAMP:
        return 0.0
    if r < -_LOG_CLAMP:
        return 1.0
    return 1.0 / (1.0 + math.exp(r))


@njit(cache=True)
def win_prob(model, p1, p2, param, luck):
    d = p1 - p2
    if model == 0:  # power
        f = _ratio_prob(p1, p2, param)
    elif model == 1:  # log5
        f = _ratio_prob(p1 * (1.0 - p2), p2 * (1.0 - p1), param)
    elif model == 2:  # logistic
        x = -param * d
        if x > _LOG_CLAMP:
            f = 0.0
        else:
            f = 1.0 / (1.0 + math.exp(x))
    elif model == 3:  # probit
        f = 0.5 * (1.0 + math.erf(param * d / math.sqrt(2.0)))
    elif model == 4:  # arctan
        f = 0.5 + math.atan(param * d) / math.pi
    elif model == 5:  # linear
        f = min(1.0, max(0.0, 0.5 + 0.5 * param * d))
    elif model == 6:  # powdiff
        if d == 0.0:
            f = 0.5
        elif d > 0.0:
            f = 0.5 + 0.5 * abs(d) ** param
        else:
            f = 0.5 - 0.5 * abs(d) ** param
    else:  # uniform noise
        s = d / (2.0 * param)
        if s >= 1.0:
            f = 1.0
        elif s <= -1.0:
            f = 0.0
        elif s >= 0.0:
            f = 1.0 - 0.5 * (1.0 - s) * (1.0 - s)
        else:
            f = 0.5 * (1.0 + s) * (1.0 + s)
    return (1.0 - luck) * f + 0.5 * luck


@njit(cache=True)
def build_win_matrix(p, model, param, luck):
    """W[i, j] = probability that player i beats player j (i attacks j)."""
    n = p.shape[0]
    w = np.empty((n, n), dtype=np.float64)
    for i in range(n):
        w[i, i] = 0.5
        for j in range(i + 1, n):
            x = win_prob(model, p[i], p[j], param, luck)
            w[i, j] = x
            w[j, i] = 1.0 - x
    return w


def models_for_api():
    return MODELS
