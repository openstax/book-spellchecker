
start checker:
```
docker run --cap-drop ALL   --cap-add CAP_SETUID   --cap-add CAP_SETGID   --cap-add CAP_CHOWN   --security-opt no-new-privileges   --publish 8011:8010   --env download_ngrams_for_langs=en   --env langtool_languageModel=/ngrams   --env langtool_fasttextModel=/fasttext/lid.176.bin   --volume $PWD/ngrams:/ngrams   --volume $PWD/fasttext:/fasttext   meyay/languagetool:latest
```

```
node spellcheck.js ../osbooks-biology-bundle | tee output.csv
```
