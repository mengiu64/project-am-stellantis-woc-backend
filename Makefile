# Ogni artifact contiene solo la propria Lambda e il trasporto REST condiviso.
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c

define build-service
build-$(1):
	mkdir -p "$(ARTIFACTS_DIR)/$(2)" "$(ARTIFACTS_DIR)/serviceClient"
	tar -C "$(2)" --exclude='./node_modules' --exclude='./__tests__' --exclude='./coverage' --exclude='./.env*' --exclude='./test*.js' -cf - . | tar -C "$(ARTIFACTS_DIR)/$(2)" -xf -
	tar -C serviceClient --exclude='./node_modules' --exclude='./__tests__' --exclude='./coverage' --exclude='./.env*' -cf - . | tar -C "$(ARTIFACTS_DIR)/serviceClient" -xf -
	cd "$(ARTIFACTS_DIR)/$(2)" && npm ci --omit=dev --no-audit --no-fund
	cd "$(ARTIFACTS_DIR)/serviceClient" && npm ci --omit=dev --no-audit --no-fund
endef

$(eval $(call build-service,AgendaSoaNagaFunction,agendaSoaNaga))
$(eval $(call build-service,DmsFunction,dms))
$(eval $(call build-service,JobCardFunction,jobcard))
$(eval $(call build-service,DjcFunction,djc))
$(eval $(call build-service,V360Function,v360))
$(eval $(call build-service,PkEperFunction,pkEper))
$(eval $(call build-service,PkDocsoaFunction,pkDocsoa))
$(eval $(call build-service,PkMenupricingFunction,pkMenupricing))
$(eval $(call build-service,PkManagerFunction,pkManager))
$(eval $(call build-service,SessionFunction,session))
$(eval $(call build-service,MyPeopleFunction,myPeople))
$(eval $(call build-service,PkFavoriteFunction,pkFavorite))
$(eval $(call build-service,DbManagerFunction,dbManager))
$(eval $(call build-service,HqManagerFunction,hqManager))
$(eval $(call build-service,DmlConfigSyncFunction,dmlConfigSync))
$(eval $(call build-service,SynchStatusFunction,synch-status))
