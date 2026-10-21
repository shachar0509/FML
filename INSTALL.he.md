# התקנת שלב

שלב היא תוסף ל-**Claude Desktop** (macOS או Windows). היא משתמשת במנוי Claude שלך: אין מפתח API ואין עלות נוספת.

1. התקינו את [Claude Desktop](https://claude.ai/download) והתחברו.
2. הורידו את `shalav.mcpb` מעמוד ה-release האחרון.
3. לחצו עליו פעמיים (או גררו אותו אל Claude Desktop ← Settings ← Extensions) ולחצו **Install**.
4. בחרו את **תיקיית הנתונים** (ברירת מחדל `Documents/Shalav`) ואת השפה, והפעילו את התוסף.
   - כדי לעבוד משני מחשבים, שימו את תיקיית הנתונים בתוך Google Drive / OneDrive / iCloud Drive לשולחן העבודה ובחרו את אותה תיקייה בשניהם.
5. בכל שיחה כתבו **שלב**, או בחרו **Shalav ← My courses** מתפריט ה-prompts (כפתור **+**). כרטיס הבית ייפתח בשיחה.

## עדכונים
הורידו `shalav.mcpb` חדש והתקינו מעל הישן. תיקיית הנתונים לא נפגעת.

## Claude Code (אופציונלי)
```bash
git clone <repo> && cd <repo> && pnpm install && pnpm build:cards && pnpm build:server
claude mcp add shalav -- node "$PWD/dist/server.mjs"
```
המשתנה `SHALAV_DATA_FOLDER` קובע את תיקיית הנתונים.

## פתרון בעיות
- **הכרטיס לא מופיע:** עדכנו את Claude Desktop וודאו שהתוסף מופעל (Settings ← Extensions).
- **Claude לא ממשיך אחרי לחיצה בכרטיס:** כתבו "המשך" בשיחה.
- **קונפליקטי סנכרון:** קובץ כמו `name (1).jsonl` או "(conflicted copy)" מתעלמים ממנו, והוא מופיע בכרטיס ההגדרות של שלב. מחקו אותו אחרי שבדקתם שלא חסר מידע.
