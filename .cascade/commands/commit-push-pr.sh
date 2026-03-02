#!/bin/bash
MESSAGE=$1
shift
git add "$@"
git commit -m "$MESSAGE"
git push origin HEAD
