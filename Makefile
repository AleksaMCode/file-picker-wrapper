dist:
	mkdir -p dist && rsync -rupE index.* file-picker.min.* *-styles.css oidc-* img favicon.ico dist

.PHONY: dist
