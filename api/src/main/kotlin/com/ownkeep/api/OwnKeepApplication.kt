package com.ownkeep.api

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.context.properties.ConfigurationPropertiesScan
import org.springframework.boot.runApplication

@SpringBootApplication
@ConfigurationPropertiesScan
class OwnKeepApplication

fun main(args: Array<String>) {
    runApplication<OwnKeepApplication>(*args)
}
